/**
 * Bitcoin multisig signature logic, Bitcoin transaction sending and reading data from the Bitcoin network
 */
import {inject, injectable} from 'inversify';
import {bip32, ECPair, Network, networks, Payment, payments, Psbt} from "bitcoinjs-lib";
import {normalizeKey, xprvToPublic} from './utils';
import getByteCount from './bytecount';
import BitcoinNodeWrapper, {IBitcoinNodeWrapper} from './nodewrapper';
import {BigNumber} from 'ethers';
import {Config, ConfigSecrets} from '../config';
import {script} from "bitcoinjs-lib";
import Logger from '../logger';


export interface PartiallySignedBitcoinTransaction {
    serializedTransaction: string;
    signedPublicKeys: string[];
    requiredSignatures: number;
}

export interface BtcTransfer {
    btcAddress: string;
    amountSatoshi: BigNumber;
    nonce: number;
}

// https://developer.bitcoin.org/reference/rpc/gettransaction.html
// this is only partially reflected here because we don't need everything
export interface BitcoinRPCGetTransactionResponse {
    confirmations: number;
}

export type BitcoinMultisigSecrets = Pick<ConfigSecrets,'btcMasterPrivateKey' | 'btcMasterPublicKeys'>
export type BitcoinMultisigConfig = Pick<Config,
    'btcKeyDerivationPath' | 'numRequiredSigners'
> & {
    secrets: () => BitcoinMultisigSecrets,
}

@injectable()
export class BitcoinMultisig {
    private logger = new Logger('btc-multisig');

    public readonly network: Network;
    private gasSatoshi = 10; // TODO: make variable/configurable
    private nodeWrapper: IBitcoinNodeWrapper;
    private readonly masterPrivateKey: () => string;
    private readonly masterPublicKey: string;
    private masterPublicKeys: string[];
    private readonly keyDerivationPath: string;
    private readonly maximumBatchSize = 40;
    public readonly payoutScript: Payment;
    private readonly cosigners: number;

    constructor(
        @inject(Config) config: BitcoinMultisigConfig,
        @inject(BitcoinNodeWrapper) nodeWrapper: IBitcoinNodeWrapper,
    ) {
        // ensure that we don't even construct an instance if we
        // cannot calculate the transaction hashes from unsigned PSBTs
        this._testGetPsbtEarlyTxHash();

        this.network = nodeWrapper.network;

        this.nodeWrapper = nodeWrapper;

        this.cosigners = config.numRequiredSigners;
        // TODO: this part should be get rid of -- factor multisig.ts better to enable multisigs without private key
        // but to not enable it in the multisig that handles the
        if (config.secrets().btcMasterPrivateKey) {
            const masterPrv = normalizeKey(config.secrets().btcMasterPrivateKey);
            this.masterPrivateKey = () => masterPrv;
            this.masterPublicKey = xprvToPublic(this.masterPrivateKey(), this.network);
        } else {
            this.masterPrivateKey = () => '';
            this.masterPublicKey = '';
        }
        this.masterPublicKeys = config.secrets().btcMasterPublicKeys;

        this.keyDerivationPath = config.btcKeyDerivationPath || '0/0/0';

        let childPublic: Buffer[] = this.deriveChildPublicKeys(this.keyDerivationPath);
        this.payoutScript = payments.p2wsh({
            network: this.network,
            redeem: payments.p2ms({
                m: this.cosigners,
                pubkeys: childPublic,
                network: this.network,
            }),
        });
    }

    getBitcoinTransactionHash(signedBitcoinTransaction: PartiallySignedBitcoinTransaction): string {
        const psbtUnserialized = Psbt.fromBase64(
            signedBitcoinTransaction.serializedTransaction, {network: this.network}
        );
        return this.getPsbtEarlyTxHash(psbtUnserialized);
    }

    /**
     * Return the TX hash for the transaction that would be formed from the psbt.
     * Since the legacy inputs are *changed* by signatures this can only work for
     * segwit inputs, and therefore this method will throw if given a transaction
     * that has any non-segwit input (and for that matter any non-multisig).
     *
     * This is an ugly hack but so is bitcoinjs-lib in its entirety.
     *
     * @param psbt
     */
    getPsbtEarlyTxHash(psbt: Psbt) {
        for (let i = 0; i < psbt.inputCount; i++) {
            const type = psbt.getInputType(i);
            if (type !== 'p2wsh-multisig') {
                throw new Error(`getPsbtEarlyTxHash works only with witness inputs, got one of type ${type}`)
            }
        }

        return (psbt.clone() as any).__CACHE.__TX.getHash().reverse().toString('hex');
    }

    /**
     * ensure that we still can calculate the TX hash with the current bitcoinjs-lib
     *
     * @private
     */
    private _testGetPsbtEarlyTxHash() {
        const keys = [
            'ab05a54fed20a4282667cbddd2f4bca832cb7936b82136023a65f05c76cd9561',
            '26563a46b59b2467d0b05d6c404663525f1cea35565141e03285d4b516d1df09',
            '148e0aa582a994f7c7246496f51b1aa96fa8e99dcd77fd78502425c579edd896',
        ].map((s) => ECPair.fromPrivateKey(
            Buffer.from(s, 'hex'),
            {network: networks.testnet})
        );

        // a testnet PSBT with segwit multisig 2 of 3 having the keys above for the
        // only input and paying to a testnet Bech32 address
        const psbt = Psbt.fromHex(
            '70736274ff0100520200000001a40c99cc64b4cd223709f1aa3d0dd2199ab672' +
            'cf6054a9d2e5a9199eee18dd0e0100000000ffffffff01393000000000000016' +
            '00144479be354b516ada29b9ebffbb131046007d74d500000000000100ea0200' +
            '00000001018ff776782cea7e1883d91042f58a4e7523f3f4b8329e89f3c9528b' +
            'b324c28a8f0000000000feffffff0275fe9f000000000016001470efd2ab8f4d' +
            '8a4dc0baac4e31a1f58090c9eb17a086010000000000220020f69c88c8cc0e10' +
            '16a40ce854868286d9f2973724a64f1f6dc6feb2a9ed7df8ca0247304402205c' +
            'c657bd68f54afca4d7bb8b7f0fc412b28a08264f8f368920eaa513dfb5656c02' +
            '205d7b4a5088e43a990cc2357e9fbd466796b680c9e8317c0f112e2cea8f3bb4' +
            'b2012102bf84edc467a70101ee612f9fcf15b1f92e3e1389d514602a0a7c9f18' +
            '01815385f815200001056952210334b537c76f634a18104a85a76f4e9a3a6ad7' +
            '1d68ea0ee072ffce8bd00098ec5b21031cac5e2d753770da3e621760480250e1' +
            '8ca829dd2e2db2c2a68f6c0e30e6a74c2102c8ce8ee4901a26ba3f31294b03d0' +
            '3aefc3970a88ac576bc2f8f2f4160635697653ae0000',
            {
                network: networks.testnet
            }
        );

        const earlyTxHash = this.getPsbtEarlyTxHash(psbt);

        psbt.signAllInputs(keys[2]);
        psbt.signAllInputs(keys[0]);

        psbt.validateSignaturesOfAllInputs();
        psbt.finalizeAllInputs();

        const finalTxHash = psbt.extractTransaction().getHash().reverse().toString('hex');

        if (earlyTxHash !== finalTxHash) {
            throw new Error("Bitcoinjs lib does not work properly for deriving tx hash for witness PSBT early!");
        }
    }

    deriveChildPublicKeys(path: string): Buffer[] {
        const childPublic: Buffer[] = this.masterPublicKeys.map((pubKey) =>
            bip32.fromBase58(pubKey, this.network).derivePath(this.keyDerivationPath).publicKey,
        );
        childPublic.sort((a, b) => {
            return a.toString('hex') < b.toString('hex') ? -1 : 1;
        });
        return childPublic;
    }

    async createPartiallySignedTransaction(transfers: BtcTransfer[], signSelf: boolean = false): Promise<PartiallySignedBitcoinTransaction> {
        if (transfers.length > this.maximumBatchSize) {
            throw new Error(`The number of transfers ${transfers.length} exceeds the maximum batch size ${this.maximumBatchSize}`);
        }

        const network = this.network;
        const inputType = `MULTISIG-P2WSH:${this.cosigners}-${this.masterPublicKeys.length}`;
        const payment = this.payoutScript;

        const response = await this.nodeWrapper.call("listunspent",
            [1, 9999999, [payment.address]],  // !!!
        );

        response.sort((a: any, b: any) => {
            if (a.confirmations > b.confirmations) {
                return -1;
            } else if (a.confirmations < b.confirmations) {
                return 1;
            }

            return 0;
        });

        const amountSatoshi: BigNumber = transfers.map(t => t.amountSatoshi).reduce(
            (a, b) => a.add(b), BigNumber.from(0),
        );
        const psbt = new Psbt({network});

        let totalSum = BigNumber.from(0);
        let outputCounts = {
            'P2WSH': 2, // OP_RETURN data + change address; this actually always exceeds the byte size of the OP_RETURN
        };
        let inputCounts = {
            [inputType]: 0,
        };

        let fee = BigNumber.from(0);
        for (const utxo of response) {
            const tx = await this.getRawTx(utxo.txid);

            if (tx && tx.hex) {
                const input = {
                    hash: utxo.txid,
                    index: utxo.vout,
                    nonWitnessUtxo: Buffer.from(tx.hex, 'hex'),
                    witnessScript: payment.redeem!.output,
                };

                psbt.addInput(input);
                inputCounts[inputType]++;
                totalSum = totalSum.add(BigNumber.from(Math.round(utxo.amount * 1e8)));

                fee = BigNumber.from(
                    getByteCount(
                        inputCounts,
                        outputCounts,
                        transfers.map(t => t.btcAddress),
                        this.network
                    )
                    * this.gasSatoshi
                );
                if (totalSum.gte(amountSatoshi.add(fee))) {
                    break;
                }
            }
        }

        const transferSumIncludingFee = amountSatoshi.add(fee);
        if (totalSum.lt(transferSumIncludingFee)) {
            throw new Error(
                `balance is too low (can only send up to ${totalSum.toString()} satoshi out of ` +
                `${transferSumIncludingFee.toString()} required)`
            );
        }

        const dataPayload: number[] = transfers.map((e) => e.nonce);
        const dataOutput = payments.embed(
            {data: [Buffer.from(dataPayload)]},
        );

        psbt.addOutput({
            script: dataOutput.output!,
            value: 0,
        });

        for (let transfer of transfers) {
            psbt.addOutput({
                address: transfer.btcAddress,
                value: transfer.amountSatoshi.toNumber(),
            });
        }

        // change money!
        psbt.addOutput({
            address: payment.address!,
            value: totalSum.sub(fee).sub(amountSatoshi).toNumber(),
        });

        let ret: PartiallySignedBitcoinTransaction = {
            serializedTransaction: psbt.toBase64(),
            signedPublicKeys: [],
            requiredSignatures: this.cosigners,
        };
        if (signSelf) {
            ret = this.signTransaction(ret);
        }
        return ret;
    }

    getTransactionTransfers(tx: PartiallySignedBitcoinTransaction): BtcTransfer[] {
        const psbtUnserialized = Psbt.fromBase64(tx.serializedTransaction, {network: this.network});
        const transferLength = psbtUnserialized.txOutputs.length - 2;
        if (transferLength < 1) {
            throw new Error(
                `The partial transaction does not have enough outputs, ` +
                `should have at least 3 outputs, has ${transferLength + 2}`);
        }

        const dataOutput = psbtUnserialized.txOutputs[0];
        if (dataOutput.value != 0) {
            throw new Error(`The OP_RETURN output has non-zero value!`);
        }

        const fragments = script.decompile(dataOutput.script.slice(0))!;
        if (fragments[0] !== 0x6A) {
            throw new Error(`The data part does not start with OP_RETURN!`);
        }

        if (fragments.length !== 2) {
            throw new Error('Malformed OP_RETURN data embed, does not decompile to two parts')
        }

        const [dataPayment] = script.toStack([fragments[1]]);

        if (dataPayment.length !== transferLength) {
            throw new Error("The OP_RETURN embedded data size does not match the number of transfers!");
        }

        const changeOutput = psbtUnserialized.txOutputs[psbtUnserialized.txOutputs.length - 1];
        if (! changeOutput.address || changeOutput.address !== this.payoutScript.address) {
            throw new Error(`Proposed transaction is trying to pay change to ${changeOutput.address}, which does not match expected ${this.payoutScript.address}`);
        }

        // TODO: estimate the Bitcoin gas cost and make it sensible!

        const alreadyTransferred = new Set<string>();

        // ensure that all the transfers are sane, and make a list of them. Check that
        // - the output has address
        // - that the output address is a bech32 address for this network
        // - that the nonce is valid (i.e. not 255 and that we do not suddenly get negative ones...
        // - that the address/nonce pair is not being spent *twice* in this transaction
        return psbtUnserialized.txOutputs.slice(1, -1).map((output, i) => {
            if (!output.address) {
                throw new Error(`Transaction output ${output.script} does not have address!`);
            }

            const nonce = dataPayment[i];
            // 0xFF is considered invalid!
            if (nonce < 0 || nonce >= 255) {
                throw new Error(`Invalid nonce ${nonce}`);
            }

            const key = `${output.address}/${nonce}`;
            if (alreadyTransferred.has(key)) {
                throw new Error(`${output.address}/${nonce} is spent twice!`);
            }

            return {
                btcAddress: output.address!,
                amountSatoshi: BigNumber.from(output.value),
                nonce: nonce,
            };
        });
    }

    getThisNodePublicKey(): string {
        return this.masterPublicKey;
    }

    signTransaction(tx: PartiallySignedBitcoinTransaction): PartiallySignedBitcoinTransaction {
        if (!this.masterPublicKey) {
            throw new Error('No private key -- cannot sign');
        }

        if (tx.signedPublicKeys.indexOf(this.masterPublicKey) !== -1) {
            throw new Error('already signed by this node');
        }

        const childPrivateKey = bip32.fromBase58(this.masterPrivateKey(), this.network).derivePath(this.keyDerivationPath);
        const ecPair = ECPair.fromWIF(childPrivateKey.toWIF(), this.network);

        const psbtUnserialized = Psbt.fromBase64(tx.serializedTransaction, {network: this.network});
        psbtUnserialized.signAllInputs(ecPair);
        const serializedTransaction = psbtUnserialized.toBase64();
        return {
            serializedTransaction,
            signedPublicKeys: [...tx.signedPublicKeys, this.masterPublicKey],
            requiredSignatures: tx.requiredSignatures,
        }
    }

    async combine(txs: PartiallySignedBitcoinTransaction[]): Promise<PartiallySignedBitcoinTransaction> {
        this.logger.debug("combining", txs);
        if (! txs.length) {
            throw new Error('Cannot combine zero transactions');
        }

        let result: PartiallySignedBitcoinTransaction = txs[0];
        for (const tx of txs.slice(1)) {
            if (result.signedPublicKeys.length == result.requiredSignatures) {
                return result;
            }

            if (result.signedPublicKeys.length > result.requiredSignatures) {
                throw new Error('Oof the combined psbt has too many signatures already');
            }

            const resultUnserialized = Psbt.fromBase64(
                result.serializedTransaction,
                {network: this.network}
            );

            const txUnserialized = Psbt.fromBase64(
                tx.serializedTransaction,
                {network: this.network}
            );

            const combined = resultUnserialized.combine(txUnserialized);
            result = {
                serializedTransaction: combined.toBase64(),
                signedPublicKeys: [...result.signedPublicKeys, ...tx.signedPublicKeys],
                requiredSignatures: tx.requiredSignatures,
            }
        }
        return result;
    }

    async submitTransaction(tx: PartiallySignedBitcoinTransaction) {
        const psbtFinal = Psbt.fromBase64(tx.serializedTransaction, {network: this.network});

        psbtFinal.validateSignaturesOfAllInputs();
        psbtFinal.finalizeAllInputs();

        const rawTx = psbtFinal.extractTransaction().toHex();
        await this.nodeWrapper.call('sendrawtransaction', [rawTx]);
    }

    async getTransaction(transactionHash: string): Promise<BitcoinRPCGetTransactionResponse|undefined> {
        try {
            return await this.nodeWrapper.call('gettransaction', [transactionHash]);
        } catch (e: any) {
            // this is the transient error with message ~ "Invalid or non-wallet transaction id"
            if (e.code === -5) {
                return undefined;
            }
            throw e;
        }
    }

    private async getRawTx(txId: string): Promise<any> {
        return await this.nodeWrapper.call("gettransaction", [txId, true]);
    }

    /**
     * Check that the given BTC address is sane
     * @param address
     * @private
     */
    public validateAddress(address: string): boolean {
        try {
            const psbt = new Psbt({network: this.network});
            psbt.addOutput({address, value: 1});
            return psbt.txOutputs[0].address == address;
        }
        catch (e) {
            this.logger.exception(e, `Received invalid address ${address}`);
            return false;
        }
    }

    /**
     * Return the balance controlled by the multisig address
     */
    public async getMultisigBalance(): Promise<number> {
        const myAddress = this.payoutScript.address;
        const unspent: {amount: number}[] = await this.nodeWrapper.call('listunspent', [null, null, [myAddress]]);
        return unspent.reduce((a, b) => (a + b.amount), 0);
    }

    /**
     * Return the health status (true = healthy) of the connection to the bitcoin rpc node.
     * In the future, this can be extended to also check that the multisig has been loaded, for example.
     */
    public async healthCheck(): Promise<boolean> {
        let expectedChain: 'main' | 'test' | 'regtest';
        if (this.network === networks.bitcoin) {
            expectedChain = 'main';
        } else if (this.network === networks.testnet) {
            expectedChain = 'test';
        } else if (this.network === networks.regtest) {
            expectedChain = 'regtest';
        } else {
            throw new Error('Unknown network' + this.network.toString());
        }
        try {
            const blockChainInfo = await this.nodeWrapper.call('getblockchaininfo', []);
            if (blockChainInfo.chain !== expectedChain) {
                this.logger.error(
                    `Invalid chain from getblockchaininfo, expected ${expectedChain}, got ${blockChainInfo.chain}`
                );
                return false;
            }
        } catch (e) {
            this.logger.exception(e, 'Connection to the Bitcoin RPC cannot be established (getblockchaininfo failed)')
            return false;
        }

        const myAddress = this.payoutScript.address;
        try {
            const addressInfo = await this.nodeWrapper.call('getaddressinfo', [myAddress]);
            let addressInfoOk: boolean;
            if (this.network === networks.regtest) {
                // for regtest this is just the test suite, it is ok if it is not solvable...
                addressInfoOk = addressInfo.iswatchonly;
            }
            else {
                // require that the address is solvable for other cases.
                // This is required for the descriptor to have been imported properly.
                addressInfoOk = addressInfo.solvable;
            }

            if (! addressInfoOk) {
                this.logger.error(`Bitcoin node not set up correctly; cannot solve ${myAddress} - getaddressinfo returned:`
                    + `\n${JSON.stringify(addressInfo, null, 4)})`);
                return false;
            }
        }
        catch (e) {
            this.logger.exception(e, `Unexpected exception while resolving (getaddressinfo ${myAddress} failed)`)
            return false;
        }

        return true;
    }
}
