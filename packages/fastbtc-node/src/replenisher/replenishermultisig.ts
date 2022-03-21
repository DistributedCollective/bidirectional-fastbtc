import {BitcoinMultisig, BitcoinRPCGetTransactionResponse, PartiallySignedBitcoinTransaction} from '../btc/multisig';
import BitcoinNodeWrapper from '../btc/nodewrapper';
import Logger from '../logger';
import {BigNumber} from 'ethers';
import {bip32, Network, networks, Psbt} from 'bitcoinjs-lib';
import {ReplenisherConfig} from './config';

export class ReplenisherMultisig {
    private logger = new Logger('replenisher');

    private replenisherMultisig: BitcoinMultisig;
    private numRequiredSigners;
    private replenishThreshold = 1.0;
    private replenishMinAmount = 1.0;
    private replenishMaxAmount = 5.0;
    private isReplenisher: boolean; // is this node a replenisher
    private network: Network;

    constructor(
        config: ReplenisherConfig,
        private bitcoinMultisig: BitcoinMultisig,
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
            })
        );
    }

    async shouldReplenish(): Promise<boolean> {
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

        let replenishAmount = multisigBalance - this.replenishThreshold;
        replenishAmount = Math.max(replenishAmount, this.replenishMinAmount);
        replenishAmount = Math.min(replenishAmount, this.replenishMaxAmount);
        const nonce = 0; // This ensures we can only send once lol
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
        )
    }

    signReplenishPsbt(tx: PartiallySignedBitcoinTransaction): PartiallySignedBitcoinTransaction {
        const psbtUnserialized = Psbt.fromBase64(tx.serializedTransaction, {network: this.replenisherMultisig.network});
        // blah blah blah this is terrible
        if (psbtUnserialized.txOutputs.length != 2 && psbtUnserialized.txOutputs.length != 3) {
            throw new Error(`Expected 2 or 3 outputs (one for nonce, one for replenish and maybe one for change), got ${psbtUnserialized.txOutputs.length}`);
        }
        const output = psbtUnserialized.txOutputs[1];
        const multisigAddress = this.bitcoinMultisig.changePayment.address;
        if(output.address != multisigAddress) {
            throw new Error(`Invalid address, got ${output.address}, expected multisig address ${multisigAddress}`);
        }

        if (!this.isReplenisher) {
            this.logger.warning('Not replenisher, cannot sign');
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