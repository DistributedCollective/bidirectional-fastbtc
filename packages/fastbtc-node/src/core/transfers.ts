import {inject, injectable} from 'inversify';
import {BitcoinMultisig, PartiallySignedBitcoinTransaction} from '../btc/multisig';
import {EthersProvider} from '../rsk/base';
import {ethers} from 'ethers';
import {DBConnection} from '../db/connection';
import {Connection, EntityManager} from 'typeorm';
import {Config} from '../config';
import {BitcoinTransferBatchStatus, StoredBitcoinTransferBatch, Transfer, TransferStatus} from '../db/models';
import {EventScanner, Scanner} from '../rsk/scanner';
import Logger from '../logger';


// NOTE: if the SerializedBitcoinTransferBatch interface is changed in a backwards-incompatible way,
// we need to handle versioning

export interface SerializedBitcoinTransferBatch {
    transferIds: string[];
    signedBtcTransaction: PartiallySignedBitcoinTransaction;
    rskUpdateSignatures: string[];
    rskSigners: string[];
}


export class BitcoinTransferBatch implements BitcoinTransferBatch {
    constructor(
        public transfers: Transfer[],
        public signedBtcTransaction: PartiallySignedBitcoinTransaction,
        public rskUpdateSignatures: string[],
        public rskSigners: string[],
    ) {
    }

    get transferIds(): string[] {
        return this.transfers.map(t => t.transferId);
    }

    serialize(): SerializedBitcoinTransferBatch {
        return {
            transferIds: this.transferIds,
            signedBtcTransaction: this.signedBtcTransaction,
            rskUpdateSignatures: this.rskUpdateSignatures,
            rskSigners: this.rskSigners,
        }
    }

    getTransferByBitcoinAddressAndNonce(btcAddress: string, nonce: number): Transfer|undefined {
        return this.transfers.find(t => t.btcAddress === btcAddress && t.nonce === nonce);
    }
}

export class BitcoinTransferValidationError extends Error {
    isValidationError = true;
}
export class BitcoinTransferBatchDeserializationError extends Error {
    isDeserializationError = true;
}



//export class TransferBatch {
//    constructor(
//        public readonly transferIds: string[],
//        public readonly signedBtcTransaction: PartiallySignedBitcoinTransaction,
//        public readonly rskUpdateSignatures: string[],
//        public readonly nodeIds: string[],
//        public readonly isDue: boolean,
//    ) {
//    }
//}

export type BitcoinTransferServiceConfig = Pick<
    Config,
    'numRequiredSigners' | 'maxPassedBlocksInBatch' | 'maxTransfersInBatch'
>

@injectable()
export class BitcoinTransferService {
    private logger = new Logger('transfers');

    constructor(
        @inject(EthersProvider) private ethersProvider: ethers.providers.Provider,
        @inject(DBConnection) private dbConnection: Connection,
        @inject(BitcoinMultisig) private btcMultisig: BitcoinMultisig,
        // TODO: factor the code better.. this should not require EventScanner
        @inject(Scanner) private eventScanner: EventScanner,
        @inject(Config) private config: BitcoinTransferServiceConfig,
    ) {
    }

    // TODO: DB stuff

    async getNextTransferBatch(): Promise<BitcoinTransferBatch> {
        return this.dbConnection.transaction(async transaction => {
            // TODO: validation etc
            const pendingTransfer = await this.getPendingTransferBatch(transaction);
            if (pendingTransfer) {
                return pendingTransfer;
            }

            // TODO: store to DB
            const transfers = await this.getNextBatchTransfers(transaction);
            const signedBtcTransaction = await this.btcMultisig.createPartiallySignedTransaction(transfers);
            const rskUpdateSignatures: string[] = [];
            const rskSigners: string[] = [];
            return new BitcoinTransferBatch(
                transfers,
                signedBtcTransaction,
                rskUpdateSignatures,
                rskSigners,
            );
        });
    }

    async deserialize(serialized: SerializedBitcoinTransferBatch): Promise<BitcoinTransferBatch> {
        this.validateSerializedBitcoinTransferBatch(serialized);
        return this.dbConnection.transaction(async transaction => {
            const transferRepository = transaction.getRepository(Transfer);

            const transfers = await Promise.all(
                serialized.transferIds.map(
                    transferId => transferRepository.findOneOrFail({
                        where: {transferId},
                    })
                )
            );

            return new BitcoinTransferBatch(
                transfers,
                serialized.signedBtcTransaction,
                serialized.rskUpdateSignatures,
                serialized.rskSigners,
            )
        });
    }

    async isTransferBatchDue(transferBatch: BitcoinTransferBatch): Promise<boolean> {
        if (transferBatch.transfers.length === 0) {
            return false;
        }
        if (transferBatch.transfers.length >= this.config.maxTransfersInBatch) {
            return true;
        }
        const currentBlockNumber = await this.ethersProvider.getBlockNumber();
        const firstTransferBlock = Math.min(...transferBatch.transfers.map(t => t.rskBlockNumber));
        const passedBlocks = currentBlockNumber - firstTransferBlock;
        return passedBlocks >= this.config.maxPassedBlocksInBatch;
    }

    private validateSerializedBitcoinTransferBatch(serialized: SerializedBitcoinTransferBatch): void {
        if (!serialized.transferIds || !Array.isArray(serialized.transferIds)) {
            throw new BitcoinTransferBatchDeserializationError('error deserializing: transferIds missing or not an array');
        }
        if (!serialized.signedBtcTransaction) {
            throw new BitcoinTransferBatchDeserializationError('error deserializing: signedBtcTransaction missing');
        }
        if (!serialized.rskUpdateSignatures || !Array.isArray(serialized.rskUpdateSignatures)) {
            throw new BitcoinTransferBatchDeserializationError('error deserializing: rskUpdateSignatures missing or not an array');
        }
        if (!serialized.rskSigners || !Array.isArray(serialized.rskSigners)) {
            throw new BitcoinTransferBatchDeserializationError('error deserializing: rskSigners missing or not an array');
        }
    }

    private async validateTransferBatch(transferBatch: BitcoinTransferBatch): Promise<void> {
        const psbtTransfers = this.btcMultisig.getTransactionTransfers(transferBatch.signedBtcTransaction)

        if (psbtTransfers.length !== transferBatch.transfers.length) {
            throw new BitcoinTransferValidationError(
                `Transfer batch has ${transferBatch.transfers.length} transfers but the PSBT has ${psbtTransfers.length} transfers`
            );
        }
        const seenTransferIds = new Map<string, boolean>();
        for (const psbtTransfer of psbtTransfers) {
            const depositInfo = await this.eventScanner.fetchDepositInfo(psbtTransfer.btcAddress, psbtTransfer.nonce);
            const transfer = transferBatch.getTransferByBitcoinAddressAndNonce(psbtTransfer.btcAddress, psbtTransfer.nonce);

            const depositId = `${psbtTransfer.btcAddress}/${psbtTransfer.nonce}`;

            if (!transfer) {
                throw new BitcoinTransferValidationError(
                    `Batch doesn't contain transfer ${depositId}`
                );
            }

            if (seenTransferIds.get(transfer.transferId)) {
                throw new BitcoinTransferValidationError(
                    `Transfer ${transfer} is in the batch more than once`
                );
            }
            seenTransferIds.set(transfer.transferId, true);

            if (transfer.status != TransferStatus.New) {
                // TODO: log to database
                throw new BitcoinTransferValidationError(
                    `Transfer ${transfer} had invalid status ${transfer.status}, expected ${TransferStatus.New}`
                );
            }


            // TODO: maybe we should compare amount - fees and not whole amount
            if (!transfer.totalAmountSatoshi.eq(depositInfo.totalAmountSatoshi)) {
                throw new BitcoinTransferValidationError(
                    `The deposit ${depositId} has ${depositInfo.totalAmountSatoshi} in RSK but ${transfer.totalAmountSatoshi} in proposed BTC batch`
                );
            }

            if (depositInfo.status != TransferStatus.New) {
                throw new BitcoinTransferValidationError(
                    `The RSK contract has invalid state for deposit ${depositId}; expected ${TransferStatus.New}, got ${depositInfo.status}`
                );
            }
        }

        // TODO: validate signatures!
    }

    private async getNextBatchTransfers(entityManager: EntityManager): Promise<Transfer[]> {
        const transferRepository = entityManager.getRepository(Transfer);
        return transferRepository.find({
            where: {
                status: TransferStatus.New,
            },
            order: {
                // TODO: order by (blockNumber, transactionIndex, logIndex) !!
                dbId: 'ASC',
            },
            take: this.config.maxTransfersInBatch,
        })
    }

    private async getPendingTransferBatch(entityManager: EntityManager): Promise<BitcoinTransferBatch|undefined> {
        const transferBatchRepository = entityManager.getRepository(StoredBitcoinTransferBatch);
        const storedTransferBatches = await transferBatchRepository.find({
            where: [
                { status: BitcoinTransferBatchStatus.Pending },
                { status: BitcoinTransferBatchStatus.SentToRSK },
            ],
            order: {
                createdAt: 'ASC',
            }
        });
        if (storedTransferBatches.length === 0) {
            return undefined;
        }

        this.logger.info(`Found ${storedTransferBatches.length} stored transfer batches`)

        let storedBatch = storedTransferBatches.find(b => b.status === BitcoinTransferBatchStatus.SentToRSK);
        if (!storedBatch) {
            storedBatch = storedTransferBatches[0];
        }

        // TODO: should validate / prune the transfer batch here?
        return await this.deserialize(storedBatch.data as SerializedBitcoinTransferBatch);
    }
}

