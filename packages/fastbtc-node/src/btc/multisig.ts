import {inject, injectable} from 'inversify';
import {bip32, ECPair, Network, networks, payments, Psbt} from "bitcoinjs-lib";
import {normalizeKey, xprvToPublic} from './utils';
import getByteCount from './bytecount';
import BitcoinNodeWrapper from './nodewrapper';
import {BigNumber} from 'ethers';
import {Config} from '../config';


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

export type BitcoinMultisigConfig = Pick<
    Config,
    'btcRpcUrl'|'btcRpcUsername'|'btcRpcPassword'|'btcNetwork'|'btcMasterPrivateKey'|'btcMasterPublicKeys'
>

@injectable()
export class BitcoinMultisig {
    private network: Network;
    private gasSatoshi = 10; // TODO: make variable/configurable
    private cosigners = 2; // TODO: make configurable
    private nodeWrapper: BitcoinNodeWrapper;
    private masterPrivateKey: string;
    private masterPublicKey: string;
    private masterPublicKeys: string[];

    constructor(
        @inject(Config) config: BitcoinMultisigConfig,
    ) {
        this.network = networks[config.btcNetwork === 'mainnet' ? 'bitcoin' : config.btcNetwork];

        this.nodeWrapper = new BitcoinNodeWrapper({
            url: config.btcRpcUrl,
            user: config.btcRpcUsername,
            password: config.btcRpcPassword,
        });

        this.masterPrivateKey = normalizeKey(config.btcMasterPrivateKey);
        this.masterPublicKey = xprvToPublic(this.masterPrivateKey, this.network);
        this.masterPublicKeys = config.btcMasterPublicKeys;
    }

    async createPartiallySignedTransaction(transfers: BtcTransfer[]): Promise<PartiallySignedBitcoinTransaction> {
        const network = this.network;

        const childPublic = this.masterPublicKeys.map((pubKey) =>
            bip32.fromBase58(pubKey, network).derive(0).derive(6).publicKey
        );

        childPublic.sort((a, b) => {
            return a.toString('hex') < b.toString('hex') ? -1 : 1;
        });

        const inputType = `MULTISIG-P2WSH:${this.cosigners}-${this.masterPublicKeys.length}`;

        const payment = payments.p2wsh({
            network,
            redeem: payments.p2ms({
                m: this.cosigners,
                pubkeys: childPublic,
                network,
            })
        });

        const response = await this.nodeWrapper.call("listunspent",
            [1, 9999999, [payment.address]]  // !!!
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
            (a, b) => a.add(b), BigNumber.from(0)
        );
        //const amountSatoshi = Math.round(transferAmount * 1e8);
        const psbt = new Psbt({network});

        let totalSum = BigNumber.from(0);
        let outputCounts = {
            'P2WSH': 2 + transfers.length, // change!
        };
        let inputCounts = {
            [inputType]: 0
        };

        let fee = BigNumber.from(0);
        for (let utxo of response) {
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

                fee = BigNumber.from(getByteCount(inputCounts, outputCounts) * this.gasSatoshi);
                if (totalSum.gte(amountSatoshi.add(fee))) {
                    break;
                }
            }
        }

        if (totalSum.lt(amountSatoshi.add(fee))) {
            throw new Error("too schlong");
        }

        const dataOutput = payments.embed(
            {data: [Buffer.from('DEADC0DEBEEFBABE133337', 'hex')]}
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
            value: totalSum.sub(fee).sub(amountSatoshi).toNumber()
        });

        return this.signTransaction({
            serializedTransaction: psbt.toBase64(),
            signedPublicKeys: [],
            requiredSignatures: this.cosigners,
        });
    }

    async verifyTransactionContents(tx: PartiallySignedBitcoinTransaction): Promise<true> {
        const psbtUnserialized = Psbt.fromBase64(tx.serializedTransaction);
        const data = psbtUnserialized.txOutputs[0];

        console.log(data.script);
        return true;
    }

    signTransaction(tx: PartiallySignedBitcoinTransaction): PartiallySignedBitcoinTransaction {
        if (tx.signedPublicKeys.indexOf(this.masterPublicKey) !== -1) {
            throw new Error('already signed by this node');
        }

        const childPrivateKey = bip32.fromBase58(this.masterPrivateKey, this.network).derive(0).derive(6);
        const ecPair = ECPair.fromWIF(childPrivateKey.toWIF(), this.network);

        const psbtUnserialized = Psbt.fromBase64(tx.serializedTransaction);
        psbtUnserialized.signAllInputs(ecPair);
        const serializedTransaction = psbtUnserialized.toBase64();
        return {
            serializedTransaction,
            signedPublicKeys: [...tx.signedPublicKeys, this.masterPublicKey],
            requiredSignatures: tx.requiredSignatures,
        }
    }

    async submitTransaction(tx: PartiallySignedBitcoinTransaction) {
        const psbtFinal = Psbt.fromBase64(tx.serializedTransaction);

        psbtFinal.validateSignaturesOfAllInputs();
        psbtFinal.finalizeAllInputs();

        const rawTx = psbtFinal.extractTransaction().toHex();
        console.log(rawTx);
        console.log(await this.nodeWrapper.call('sendrawtransaction', [rawTx]));
        console.log('sent');
    }

    private async getRawTx(txId: string): Promise<any> {
        return await this.nodeWrapper.call("gettransaction", [txId, true]);
    }
}
