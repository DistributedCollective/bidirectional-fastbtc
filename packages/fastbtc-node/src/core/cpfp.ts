import {inject, injectable} from 'inversify';
import Logger from '../logger';
import {Network, P2PNetwork} from '../p2p/network';
import {BitcoinMultisig, CPFPValidationError, PartiallySignedBitcoinTransaction} from '../btc/multisig';
import {BitcoinTransferService, TransferBatch, TransferBatchDTO, TransferBatchValidator} from './transfers';
import {Config} from '../config';
import {setExtend, setIntersection} from '../utils/sets';
import {sleep} from '../utils';
import {MessageUnion} from 'ataraxia';

export interface CPFPBumperConfig {
    numRequiredSigners: number;
}

interface RequestCPFPSignatureMessage {
    transferBatchDto: TransferBatchDTO;
    cpfpTransaction: PartiallySignedBitcoinTransaction
    requestId: number;
}
interface CPFPSignatureResponseMessage {
    cpfpTransaction: PartiallySignedBitcoinTransaction
    requestId: number;
}
interface CPFPBumperMessage {
    'fastbtc:cpfp-bumper:request-signature': RequestCPFPSignatureMessage;
    'fastbtc:cpfp-bumper:signature-response': CPFPSignatureResponseMessage;
}


/**
 * Service for bumping transactions with CPFP
 */
@injectable()
export class CPFPBumper {
    readonly MAX_SIGNATURE_WAIT_TIME_MS = 1000 * 60 * 2;
    readonly SLEEP_TIME_MS = 1000;

    private logger = new Logger('cpfp-bumper')
    private signatureRequestId = 0;

    constructor(
        @inject(Config) private config: CPFPBumperConfig,
        @inject(P2PNetwork) private network: Network<CPFPBumperMessage>,
        @inject(BitcoinTransferService) private bitcoinTransferService: BitcoinTransferService,
        @inject(TransferBatchValidator) private transferBatchValidator: TransferBatchValidator,
        @inject(BitcoinMultisig) private btcMultisig: BitcoinMultisig,
    ) {
        network.onMessage(this.onMessage);
    }

    public async addCpfpTransaction(transferBatch: TransferBatch): Promise<TransferBatch> {
        await this.transferBatchValidator.validateForAddingCpfpTransaction(transferBatch);

        const bumpedTransaction = transferBatch.signedBtcTransaction;
        if (!bumpedTransaction) {
            throw new Error('Cannot add CPFP to a transfer batch without a signed transaction');
        }

        const initialCpfpTransaction = await this.btcMultisig.createPartiallySignedCpfpTransaction(bumpedTransaction);
        const signedCpfpTransaction = await this.requestCpfpSignatures(transferBatch, initialCpfpTransaction);
        transferBatch = await this.bitcoinTransferService.addCpfpTransaction(transferBatch, signedCpfpTransaction);
        return transferBatch;
    }

    private async requestCpfpSignatures(
        transferBatch: TransferBatch,
        initialCpfpTransaction: PartiallySignedBitcoinTransaction
    ): Promise<PartiallySignedBitcoinTransaction> {
        if (initialCpfpTransaction.signedPublicKeys.length > 0) {
            throw new Error('initialCpfpTransaction should not have any signatures');
        }
        let signedCpfpTransaction = this.btcMultisig.signTransaction(initialCpfpTransaction);
        const seenPublicKeys = new Set<string>(signedCpfpTransaction.signedPublicKeys);

        const requestId = this.signatureRequestId++;
        let gatheredPsbts: PartiallySignedBitcoinTransaction[] = [];
        const listener = this.network.onMessage(async (msg) => {
            if (msg.type !== 'fastbtc:cpfp-bumper:signature-response') {
                return;
            }
            const { requestId: responseRequestId, cpfpTransaction } = msg.data;
            if (responseRequestId !== requestId) {
                return;
            }
            try {
                this.validateCpfpTransaction(transferBatch, signedCpfpTransaction);
                gatheredPsbts.push(cpfpTransaction);
            } catch (e: any) {
                if (e.isValidationError) {
                    this.logger.warn(`Invalid CPFP signature response: ${e.message}`);
                } else {
                    this.logger.exception(e, 'Error processing CPFP signature response');
                }
            }
        });

        const maxIterations = this.MAX_SIGNATURE_WAIT_TIME_MS / this.SLEEP_TIME_MS;
        try {
            for (let iteration = 0; iteration < maxIterations; iteration++) {
                await this.network.broadcast('fastbtc:cpfp-bumper:request-signature', {
                    transferBatchDto: transferBatch.getDto(),
                    cpfpTransaction: initialCpfpTransaction,
                    requestId,
                });
                await sleep(this.SLEEP_TIME_MS)

                const newPsbts = [...gatheredPsbts];
                gatheredPsbts = [];
                for (const psbt of newPsbts) {
                    if (seenPublicKeys.size == this.config.numRequiredSigners) {
                        break;
                    }

                    const seenIntersection = setIntersection(seenPublicKeys, new Set(psbt.signedPublicKeys));
                    if (seenIntersection.size) {
                        this.logger.info(`public keys ${[...seenIntersection]} have already signed the CPFP tx`);
                        continue;
                    }

                    setExtend(seenPublicKeys, psbt.signedPublicKeys);
                    signedCpfpTransaction = this.btcMultisig.combine([signedCpfpTransaction, psbt]);
                }

                if (seenPublicKeys.size === signedCpfpTransaction.requiredSignatures) {
                    return signedCpfpTransaction;
                }
            }
            throw new Error('Timed out waiting for CPFP signatures');
        } finally {
            listener.unsubscribe();
        }
    }

    private onMessage = async (message: MessageUnion<CPFPBumperMessage>) => {
        try {
            if (message.type === 'fastbtc:cpfp-bumper:request-signature') {
                const {transferBatchDto, cpfpTransaction, requestId} = message.data;
                if (cpfpTransaction.signedPublicKeys.indexOf(this.btcMultisig.getThisNodePublicKey()) !== -1) {
                    this.logger.info('CPFP already signed by this node')
                    return;
                }

                const transferBatch = await this.bitcoinTransferService.loadFromDto(transferBatchDto)
                if (!transferBatch) {
                    this.logger.warn('TransferBatch not found');
                    return;
                }

                await this.transferBatchValidator.validateForSigningCpfpTransaction(transferBatch);
                this.validateCpfpTransaction(transferBatch, cpfpTransaction);

                this.logger.info('Signing CPFP with requestId %s', requestId)
                const signedCpfpTransaction = this.btcMultisig.signTransaction(cpfpTransaction);
                await message.source.send('fastbtc:cpfp-bumper:signature-response', {
                    cpfpTransaction: signedCpfpTransaction,
                    requestId,
                });
            }
        } catch (e: any) {
            if (e.isValidationError) {
                this.logger.warn(
                    'Validation error while processing CPFP message %s with data %s: %s',
                    message.type,
                    message.data,
                    e.message
                );
            } else {
                this.logger.exception(
                    e,
                    `Error processing CPFP message %s with data %s`,
                    message.type,
                    message.data
                );
            }
        }
    }

    private validateCpfpTransaction(
        transferBatch: TransferBatch,
        cpfpTransaction: PartiallySignedBitcoinTransaction
    ): void {
        const bumpedTransaction = transferBatch.signedBtcTransaction;
        if (!bumpedTransaction) {
            throw new CPFPValidationError('no signed transaction');
        }
        this.btcMultisig.validatePartiallySignedCpfpTransaction(bumpedTransaction, cpfpTransaction);
    }
}
