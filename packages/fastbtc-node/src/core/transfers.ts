import {inject, injectable} from 'inversify';
import {BitcoinMultisig, PartiallySignedBitcoinTransaction} from '../btc/multisig';
import {EthersProvider} from '../rsk/base';
import {ethers} from 'ethers';
import {DBConnection} from '../db/connection';
import {Connection, EntityManager} from 'typeorm';
import {Config} from '../config';
import {StoredBitcoinTransferBatch, Transfer, TransferStatus} from '../db/models';
import {EventScanner, Scanner} from '../rsk/scanner';
import Logger from '../logger';


// NOTE: if the SerializedBitcoinTransferBatch interface is changed in a backwards-incompatible way,
// we need to handle versioning

export enum BitcoinTransferBatchStatus {
    GatheringTransfers,
    Ready,
    SentStatusUpdatedToRSK,
    SentToBitcoin,
    BitcoinTransactionConfirmed,
    MinedStatusUpdatedToRSK,
}

export interface SerializedBitcoinTransferBatch {
    status: BitcoinTransferBatchStatus,
    transferIds: string[];
    signedBtcTransaction: PartiallySignedBitcoinTransaction;
    rskUpdateSignatures: string[];
    rskSigners: string[];
}

export interface SerializeOpts {
    rskSignatures: boolean;
    bitcoinSignatures: boolean;
}

export class BitcoinTransferBatch implements BitcoinTransferBatch {
    constructor(
        public status: BitcoinTransferBatchStatus,
        public transfers: Transfer[],
        public signedBtcTransaction: PartiallySignedBitcoinTransaction,
        public rskUpdateSignatures: string[],
        public rskSigners: string[],
    ) {
    }

    get transferIds(): string[] {
        return this.transfers.map(t => t.transferId);
    }

    serialize(opts ?: SerializeOpts): SerializedBitcoinTransferBatch {
        if (!opts) {
            opts = { rskSignatures: true, bitcoinSignatures: true };
        }
        return {
            status: this.status,
            transferIds: this.transferIds,
            signedBtcTransaction: this.signedBtcTransaction,
            rskUpdateSignatures: opts.rskSignatures ? this.rskUpdateSignatures : [],
            rskSigners: opts.rskSignatures ? this.rskSigners : [],
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

    async getNextTransferBatch(): Promise<BitcoinTransferBatch> {
        return this.dbConnection.transaction(async transaction => {
            const pendingTransferBatch = await this.getPendingTransferBatch(transaction);
            if (pendingTransferBatch) {
                // TODO: validation
                return pendingTransferBatch;
            }

            const transfers = await this.getNextBatchTransfers(transaction);
            // TODO: we don't really need to create the PSBT every time...
            const signedBtcTransaction = await this.btcMultisig.createPartiallySignedTransaction(transfers);
            const rskUpdateSignatures: string[] = [];
            const rskSigners: string[] = [];
            let batch = new BitcoinTransferBatch(
                BitcoinTransferBatchStatus.GatheringTransfers,
                transfers,
                signedBtcTransaction,
                rskUpdateSignatures,
                rskSigners,
            );
            if (await this.isTransferBatchDue(batch)) {
                batch.status = BitcoinTransferBatchStatus.Ready;
                await this.storeTransferBatch(batch, transaction);
            }
            return batch;
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
                serialized.status,
                transfers,
                serialized.signedBtcTransaction,
                serialized.rskUpdateSignatures,
                serialized.rskSigners,
            );
        });
    }

    async updateStoredTransferBatch(transferBatch: BitcoinTransferBatch): Promise<void> {
        await this.dbConnection.transaction(async transaction => {
            await this.storeTransferBatch(transferBatch, transaction);
        })
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

    async validateTransferBatch(transferBatch: BitcoinTransferBatch): Promise<void> {
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

        // TODO: validate status
        // TODO: validate signatures!
    }

    private validateSerializedBitcoinTransferBatch(serialized: SerializedBitcoinTransferBatch): void {
        if (typeof serialized.status === undefined) {
            throw new BitcoinTransferBatchDeserializationError('error deserializing: status missing');
        }
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
        const storedTransferBatches = await transferBatchRepository
            .createQueryBuilder('batch')
            .where(`batch->'data'->'status' < :statuses`)
            .setParameters({
                statuses: [
                    BitcoinTransferBatchStatus.GatheringTransfers,
                    BitcoinTransferBatchStatus.Ready,
                    BitcoinTransferBatchStatus.SentStatusUpdatedToRSK
                ],
            })
            .getMany();
        if (storedTransferBatches.length === 0) {
            return undefined;
        }

        this.logger.info(`Found ${storedTransferBatches.length} stored transfer batches`)

        let storedBatch = storedTransferBatches.find(b => b.data.status === BitcoinTransferBatchStatus.SentStatusUpdatedToRSK);
        if (!storedBatch) {
            storedBatch = storedTransferBatches[0];
        }

        // TODO: should validate / prune the transfer batch here?
        return await this.deserialize(storedBatch.data as SerializedBitcoinTransferBatch);
    }

    private async storeTransferBatch(transferBatch: BitcoinTransferBatch, entityManager: EntityManager): Promise<void> {
        if (transferBatch.status === BitcoinTransferBatchStatus.GatheringTransfers) {
            throw new Error('TransferBatches with status = GatheringTransfers are not to be persisted in the DB');
        }
        const transferBatchRepository = entityManager.getRepository(StoredBitcoinTransferBatch);
        let storedBatch = await this.findStoredTransferBatch(transferBatch.transferIds, entityManager);
        if (storedBatch) {
            // TODO: make this better
            if (storedBatch.data.status < transferBatch.status) {
                throw new Error('status can only go up');
            }
        } else {
            storedBatch = new StoredBitcoinTransferBatch();
        }
        storedBatch.data = transferBatch.serialize();
        await transferBatchRepository.save(storedBatch);
    }

    private async findStoredTransferBatch(transferIds: string[], entityManager: EntityManager): Promise<StoredBitcoinTransferBatch|undefined> {
        // TODO: what if one transfer is in multiple batches
        const transferBatchRepository = entityManager.getRepository(StoredBitcoinTransferBatch);
        return await transferBatchRepository
            .createQueryBuilder('batch')
            // TODO: there must be a better way to compare array unordered
            .where(`batch->'data'->'transferIds' @> :transferIds AND batch->'data'->'transferIds' <@ :transferIds`)
            .setParameters({ transferIds })
            .getOne();
    }
}
