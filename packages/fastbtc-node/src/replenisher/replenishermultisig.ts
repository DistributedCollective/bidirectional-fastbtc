import {BitcoinMultisig, BitcoinRPCGetTransactionResponse, PartiallySignedBitcoinTransaction} from '../btc/multisig';
import BitcoinNodeWrapper from '../btc/nodewrapper';
import Logger from '../logger';
import {BigNumber} from 'ethers';
import {Network, networks, Psbt} from 'bitcoinjs-lib';
import {ReplenisherConfig} from './config';
import {StatsD} from 'hot-shots';
import {MAX_BTC_IN_BATCH} from '../core/transfers';

export class ReplenisherMultisig {
    private logger = new Logger('replenisher');

    private replenisherMultisig: BitcoinMultisig;
    private numRequiredSigners;
    private replenishThreshold = MAX_BTC_IN_BATCH;
    private replenishMinAmount = MAX_BTC_IN_BATCH;
    private maxReplenishTxInputs = 100;
    private isReplenisher: boolean; // is this node a replenisher
    private network: Network;

    constructor(
        config: ReplenisherConfig,
        private bitcoinMultisig: BitcoinMultisig,
        private statsd: StatsD,
    ) {
        this.numRequiredSigners = config.numRequiredSigners;

        this.isReplenisher = !!config.secrets().masterPrivateKey;
        this.network = networks[config.btcNetwork === 'mainnet' ? 'bitcoin' : config.btcNetwork];

        this.replenisherMultisig = new BitcoinMultisig(
            {
                btcKeyDerivationPath: config.keyDerivationPath,
                numRequiredSigners: config.numRequiredSigners,
                secrets: () => ({
                    btcMasterPrivateKey: config.secrets().masterPrivateKey ?? '',
                    btcMasterPublicKeys: config.secrets().masterPublicKeys,
                }),
            },
            new BitcoinNodeWrapper({
                url: config.rpcUrl,
                btcNetwork: config.btcNetwork,
                user: config.rpcUserName,
                password: config.secrets().rpcPassword,
            }),
            statsd
        );
    }

    /**
     * Get the balance of the replenisher multisig, e.g. the amount of BTC that can be sent to the main multisig
     * Returns balance in BTC as a floating point number
     */
    async getBalance(opts = { logToStatsd: false }): Promise<number> {
        const ret = await this.replenisherMultisig.getMultisigBalance(false);
        if (opts.logToStatsd) {
            this.statsd.gauge('fastbtc.pegout.replenisher.balance', ret);
        }
        return ret;
    }

    /**
     * Get the balances of main multisig, replenisher multisig, and the total combined balance
     * Return a tuple of 3 numbers, [main, replenisher, total]
     */
    async getCombinedBalances(opts = { logToStatsd: false }): Promise<[number, number, number]> {
        const replenisherBalance = await this.getBalance({ logToStatsd: opts.logToStatsd });
        const multisigBalance = await this.bitcoinMultisig.getMultisigBalance(true);
        const totalBalance = replenisherBalance + multisigBalance;
        if (opts.logToStatsd) {
            this.statsd.gauge('fastbtc.pegout.replenisher.totalavailablebalance', totalBalance);
        }
        return [multisigBalance, replenisherBalance, totalBalance];
    }

    async shouldReplenish(): Promise<boolean> {
        // TODO: should maybe move this to replenisher.ts
        const multisigBalance = await this.bitcoinMultisig.getMultisigBalance(true);
        return multisigBalance < this.replenishThreshold;
        //const replenisherBalance = this.replenisherMultisig.getMultisigBalance();
    }

    async createReplenishPsbt(): Promise<PartiallySignedBitcoinTransaction|null> {
        const multisigBalance = await this.bitcoinMultisig.getMultisigBalance(true);
        if (multisigBalance >= this.replenishThreshold) {
            this.logger.info(
                'Balance %s greater than threshold %s, not replenishing',
                multisigBalance,
                this.replenishThreshold
            );
            return null;
        }

        let replenishAmount = this.replenishThreshold - multisigBalance;
        replenishAmount = Math.max(replenishAmount, this.replenishMinAmount);
        // We end up sending multiple transactions with nonce 0, but since the nonce is not checked against
        // previous bitcoin transactions by the multisig, this should be ok.
        const nonce = 0;
        return await this.replenisherMultisig.createPartiallySignedTransaction(
            [
                {
                    btcAddress: this.bitcoinMultisig.changePayment.address!,
                    amountSatoshi: BigNumber.from(Math.floor(replenishAmount * 10**8)),
                    nonce,
                }
            ],
            false, //this.isReplenisher // never sign self
            true, // use descriptor-based utxo scooping
            true,
            this.maxReplenishTxInputs,
        );
    }

    signReplenishPsbt(tx: PartiallySignedBitcoinTransaction): PartiallySignedBitcoinTransaction {
        const psbtUnserialized = Psbt.fromBase64(tx.serializedTransaction, {network: this.replenisherMultisig.network});
        // blah blah blah this is terrible
        const nOutputs = psbtUnserialized.txOutputs.length;
        if (nOutputs < 2 || nOutputs > 3) {
            throw new Error(`Expected 2 or 3 outputs (one for nonce, one for replenish and maybe one for change), got ${psbtUnserialized.txOutputs.length}`);
        }

        if (psbtUnserialized.locktime !== 0) {
            throw new Error(`The replenishment transaction has invalid lock time ${psbtUnserialized.locktime}, should be zero`);
        }

        if (psbtUnserialized.inputCount > this.maxReplenishTxInputs) {
            this.logger.warning(
                `Refusing to sign replenish tx with more than ${this.maxReplenishTxInputs} inputs ` +
                `as that might hang the node.`
            );
            return tx;
        }

        const output = psbtUnserialized.txOutputs[1];
        const multisigAddress = this.bitcoinMultisig.changePayment.address;
        if (output.address != multisigAddress) {
            throw new Error(`Invalid address, got ${output.address}, expected multisig address ${multisigAddress}`);
        }

        if (nOutputs == 3) {
            if (tx.noChange) {
                throw new Error('No change but 3 outputs');
            } else if (psbtUnserialized.txOutputs[2].address !== this.replenisherMultisig.changePayment.address) {
                throw new Error('Change paid to wrong address');
            }
        }

        if (!this.isReplenisher) {
            this.logger.info('Not replenisher, cannot sign');
            return tx;
        }

        return this.replenisherMultisig.signTransaction(tx);
    }

    async combineReplenishPsbt(txs: PartiallySignedBitcoinTransaction[]): Promise<PartiallySignedBitcoinTransaction> {
        return this.replenisherMultisig.combine(txs);
    }

    async submitReplenishTransaction(tx: PartiallySignedBitcoinTransaction) {
        return this.replenisherMultisig.submitTransaction(tx);
    }

    getThisNodePublicKey(): string {
        return this.replenisherMultisig.getThisNodePublicKey();
    }

    async getBitcoinTransaction(tx: PartiallySignedBitcoinTransaction): Promise<BitcoinRPCGetTransactionResponse|undefined> {
        const txhash = this.replenisherMultisig.getBitcoinTransactionHash(tx);
        return this.replenisherMultisig.getTransaction(txhash);
    }
}
