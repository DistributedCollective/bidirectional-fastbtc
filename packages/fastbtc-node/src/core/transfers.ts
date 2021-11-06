import {inject, injectable, LazyServiceIdentifer} from 'inversify';
import {BitcoinMultisig, PartiallySignedBitcoinTransaction} from '../btc/multisig';
import {EthersProvider, EthersSigner, FastBtcBridgeContract} from '../rsk/base';
import {ethers} from 'ethers';
import {DBConnection} from '../db/connection';
import {Connection, EntityManager} from 'typeorm';
import {Config} from '../config';
import {StoredBitcoinTransferBatch, StoredBitcoinTransferBatchRepository, Transfer, TransferStatus} from '../db/models';
import {EventScanner, Scanner} from '../rsk/scanner';
import Logger from '../logger';


// NOTE: if the TransferBatchDTO interface is changed in a backwards-incompatible way,
// we need to handle versioning, because it's also stored in DB.

export interface TransferBatchDTO {
    transferIds: string[];
    rskUpdateSignatures: string[];
    rskSigners: string[];
    bitcoinTransactionHash: string;
    initialBtcTransaction: PartiallySignedBitcoinTransaction;
    signedBtcTransaction?: PartiallySignedBitcoinTransaction;
}

export interface TransferBatchEnvironment {
    numRequiredSigners: number;
    maxPassedBlocksInBatch: number;
    maxTransfersInBatch: number;
    currentBlockNumber: number;
}
export class TransferBatch {
    constructor(
        private environment: TransferBatchEnvironment,
        public transfers: Transfer[],
        public rskUpdateSignatures: string[],
        public rskSigners: string[],
        public bitcoinTransactionHash: string,
        public initialBtcTransaction: PartiallySignedBitcoinTransaction,
        public signedBtcTransaction?: PartiallySignedBitcoinTransaction,
    ) {
    }

    getTransferIds(): string[] {
        return this.transfers.map(t => t.transferId);
    }

    getTransferByBitcoinAddressAndNonce(btcAddress: string, nonce: number): Transfer|undefined {
        return this.transfers.find(t => t.btcAddress === btcAddress && t.nonce === nonce);
    }

    getDto(): TransferBatchDTO {
        return {
            transferIds: this.getTransferIds(),
            rskUpdateSignatures: this.rskUpdateSignatures,
            rskSigners: this.rskSigners,
            bitcoinTransactionHash: this.bitcoinTransactionHash,
            initialBtcTransaction: this.initialBtcTransaction,
            signedBtcTransaction: this.signedBtcTransaction,
        }
    }

    copy(): TransferBatch {
        return new TransferBatch(
            deepcopy(this.environment),
            [...this.transfers],
            [...this.rskUpdateSignatures],
            [...this.rskSigners],
            this.bitcoinTransactionHash,
            deepcopy(this.initialBtcTransaction),
            this.signedBtcTransaction ? deepcopy(this.signedBtcTransaction) : undefined,
        );
    }

    validateMatchesDto(dto: TransferBatchDTO): void {
        if (!this.hasMatchingTransferIds(dto.transferIds)) {
            throw new Error('TransferBatch transferIds and DTO transferIds do not match');
        }
        if (JSON.stringify(this.initialBtcTransaction) !== JSON.stringify(dto.initialBtcTransaction)) {
            throw new Error('TransferBatch initialBtcTransaction and DTO initialBtcTransaction do not match');
        }
        // TODO: validate signedBtcTransaction too
    }

    hasMatchingTransferIds(transferIds: string[]): boolean {
        const thisTransferIds = this.getTransferIds();
        if (transferIds.length !== thisTransferIds.length) {
            return false;
        }

        // Don't sort. Order matters. for signatures
        //thisTransferIds.sort();
        //transferIds = [...transferIds];
        //transferIds.sort()

        for(let i = 0; i < thisTransferIds.length; i++) {
            if (transferIds[i] !== thisTransferIds[i]) {
                return false;
            }
        }
        return true;
    }

    isDue(): boolean {
        const transfers = this.transfers;
        if (transfers.length === 0) {
            return false;
        }
        if (transfers.length >= this.environment.maxTransfersInBatch) {
            return true;
        }
        const firstTransferBlock = Math.min(...transfers.map(t => t.rskBlockNumber));
        const passedBlocks = this.environment.currentBlockNumber - firstTransferBlock;
        return passedBlocks >= this.environment.maxPassedBlocksInBatch;
    }

    hasEnoughRskSendingSignatures(): boolean {
        return this.rskUpdateSignatures.length >= this.environment.numRequiredSigners;
    }

    isMarkedAsSendingInRsk(): boolean {
        for (const transfer of this.transfers) {
            if(transfer.status === TransferStatus.New) {
                return false;
            }
        }
        return true;
    }

    hasEnoughBitcoinSignatures(): boolean {
        const psbt = this.signedBtcTransaction;
        return psbt ? psbt.signedPublicKeys.length >= psbt.requiredSignatures : false;
    }

    isSentToBitcoin(): boolean {
        return false;
    }

    isMarkedAsMinedInRsk(): boolean {
        for (const transfer of this.transfers) {
            if(transfer.status === TransferStatus.Mined) {
                return false;
            }
        }
        return true;
    }
}

export class TransferBatchValidationError extends Error {
    isValidationError = true;
}
export type BitcoinTransferServiceConfig = Pick<
    Config,
    'numRequiredSigners' | 'maxPassedBlocksInBatch' | 'maxTransfersInBatch'
>

@injectable()
export class BitcoinTransferService {
    private logger = new Logger('transfers');

    constructor(
        @inject(new LazyServiceIdentifer(() => TransferBatchValidator)) private validator: TransferBatchValidator,
        @inject(EthersProvider) private ethersProvider: ethers.providers.Provider,
        @inject(DBConnection) private dbConnection: Connection,
        @inject(BitcoinMultisig) private btcMultisig: BitcoinMultisig,
        @inject(FastBtcBridgeContract) private fastBtcBridge: ethers.Contract,
        @inject(EthersSigner) private ethersSigner: ethers.Signer,
        @inject(Config) private config: BitcoinTransferServiceConfig,
        // TODO: factor the code better.. this should not require EventScanner
        @inject(Scanner) private eventScanner: EventScanner,
    ) {
    }

    async getCurrentTransferBatch(): Promise<TransferBatch> {
        return this.dbConnection.transaction(async transaction => {
            const pendingBatch = await this.getPendingTransferBatch(transaction);
            if (pendingBatch) {
                return pendingBatch;
            }

            const transfers = await this.getNextBatchTransfers(transaction);
            // TODO: we don't really need to create the PSBT every time...
            const initialSignedBtcTransaction = await this.btcMultisig.createPartiallySignedTransaction(transfers);
            const rskUpdateSignatures: string[] = [];
            const rskSigners: string[] = [];
            const currentBlockNumber = await this.ethersProvider.getBlockNumber();
            const bitcoinTxHash = this.btcMultisig.getBitcoinTransactionHash(
                initialSignedBtcTransaction
            );
            const ret = new TransferBatch(
                {
                    currentBlockNumber,
                    ...this.config,
                },
                transfers,
                rskUpdateSignatures,
                rskSigners,
                bitcoinTxHash,
                initialSignedBtcTransaction,
            );

            if (ret.isDue()) {
                await this.updateStoredTransferBatch(ret);
            }
            return ret;
        });
    }

    async loadFromDto(dto: TransferBatchDTO): Promise<TransferBatch|undefined> {
        // TODO: validation
        const currentBlockNumber = await this.ethersProvider.getBlockNumber();
        return this.dbConnection.transaction(async transaction => {
            const transferRepository = transaction.getRepository(Transfer);
            const transfers: Transfer[] = [];

            for (const transferId of dto.transferIds) {
                const transfer = await transferRepository.findOne({
                    where: {transferId},
                });
                if (!transfer) {
                    // Transfer missing
                    return undefined;
                }
                transfers.push(transfer);
            }

            return new TransferBatch(
                {
                    currentBlockNumber,
                    ...this.config,
                },
                transfers,
                dto.rskUpdateSignatures,
                dto.rskSigners,
                dto.bitcoinTransactionHash,
                dto.initialBtcTransaction,
                dto.signedBtcTransaction
            );
        });
    }

    async updateStoredTransferBatch(transferBatch: TransferBatch): Promise<void> {
        await this.dbConnection.transaction(async transaction => {
            const transferBatchRepository = transaction.getCustomRepository(StoredBitcoinTransferBatchRepository);
            await transferBatchRepository.createOrUpdateFromTransferBatch(transferBatch.getDto());
        });
    }

    async addRskSendingSignatures(transferBatch: TransferBatch, signaturesAndAddresses: {signature: string, address: string}[]): Promise<TransferBatch> {
        // TODO: validate transfer batch status, maybe
        transferBatch  = transferBatch.copy();
        for(const {address, signature} of signaturesAndAddresses) {
            // TODO: validate that signature matches address and that address is a valid federator
            if (transferBatch.rskSigners.indexOf(address) !== -1) {
                this.logger.info(`address ${address} has already signed`);
                continue;
            }
            if (transferBatch.hasEnoughRskSendingSignatures()) {
                this.logger.info(`transfer batch has enough rsk sent signatures`);
                continue;
            }
            transferBatch.rskUpdateSignatures = [...transferBatch.rskUpdateSignatures, signature];
            transferBatch.rskSigners = [...transferBatch.rskSigners, address];
        }
        if (transferBatch.rskSigners.length === this.config.numRequiredSigners - 1) {
            const {signature, address} = await this.signRskSendingUpdate(transferBatch);
            transferBatch.rskUpdateSignatures = [...transferBatch.rskUpdateSignatures, signature];
            transferBatch.rskSigners = [...transferBatch.rskSigners, address];
        }
        await this.updateStoredTransferBatch(transferBatch);
        return transferBatch;
    }

    async addBitcoinSignatures(transferBatch: TransferBatch, psbts: PartiallySignedBitcoinTransaction[]): Promise<TransferBatch> {
        // TODO: validate signature and that public key is valid
        // TODO: validate transfer batch status. maybe
        if (transferBatch.hasEnoughBitcoinSignatures()) {
            this.logger.info('Enough bitcoin signatures already, not adding more');
            return transferBatch;
        }
        transferBatch = transferBatch.copy();
        psbts = [...psbts];
        let transferBatchPsbt = transferBatch.signedBtcTransaction ?? deepcopy(transferBatch.initialBtcTransaction);
        const numRequired = transferBatchPsbt.requiredSignatures - transferBatchPsbt.signedPublicKeys.length;

        const validPsbts: PartiallySignedBitcoinTransaction[] = [];
        const seenPublicKeys = new Map<string, boolean>();
        for (const publicKey of transferBatchPsbt.signedPublicKeys) {
            seenPublicKeys.set(publicKey, true);
        }

        for (const psbt of psbts) {
            if (psbt.signedPublicKeys.length === 0) {
                this.logger.info('empty psbt, skipping');
                continue;
            }
            for (const publicKey of psbt.signedPublicKeys) {
                if (seenPublicKeys.get(publicKey)) {
                    this.logger.info(`public key ${publicKey} has already signed`);
                    continue;
                }
                seenPublicKeys.set(publicKey, true);
            }
            // TODO: validate key/signature
            validPsbts.push(psbt);
            if (validPsbts.length === numRequired) {
                break
            }
        }

        if (validPsbts.length > 0) {
            transferBatchPsbt = await this.btcMultisig.combine([transferBatchPsbt, ...validPsbts]);
            transferBatch.signedBtcTransaction = transferBatchPsbt;
            await this.updateStoredTransferBatch(transferBatch);
        }

        return transferBatch;
    }

    async markAsSendingInRsk(transferBatch: TransferBatch): Promise<void> {
        if (!transferBatch.hasEnoughRskSendingSignatures()) {
            throw new Error('TransferBatch does not have enough signaturse to be marked as sending');
        }
        await this.dbConnection.transaction(async transaction => {
            const transferBatchRepository = transaction.getCustomRepository(StoredBitcoinTransferBatchRepository);
            const transferRepository = transaction.getRepository(Transfer);
            const result = await this.fastBtcBridge.markTransfersAsSending(
                `0x${transferBatch.bitcoinTransactionHash}`,
                transferBatch.getTransferIds(),
                transferBatch.rskUpdateSignatures
            );
            this.logger.info('result', result);
            await result.wait();
            const transfers = await Promise.all(
                transferBatch.getTransferIds().map(
                    transferId => transferRepository.findOneOrFail({
                        where: {transferId},
                    })
                )
            );
            for (const transfer of transfers) {
                transfer.status = TransferStatus.Sending;
            }
            await transferRepository.save(transfers);
            await transferBatchRepository.createOrUpdateFromTransferBatch(transferBatch.getDto());
        });
    }

    async signRskSendingUpdate(transferBatch: TransferBatch): Promise<{signature: string, address: string}> {
        if (transferBatch.transfers.length === 0) {
            throw new Error("Refusing to sign empty transfer batch");
        }
        await this.validator.validateForSigningRskSentUpdate(transferBatch);
        const updateHash = await this.fastBtcBridge.getTransferBatchUpdateHashWithTxHash(
            transferBatch.bitcoinTransactionHash,
            transferBatch.getTransferIds(),
            TransferStatus.Sending
        );
        const signature = await this.ethersSigner.signMessage(ethers.utils.arrayify(updateHash));
        const address = await this.ethersSigner.getAddress();
        return {signature, address};
    };

    async sendToBitcoin(transferBatch: TransferBatch): Promise<void> {
        if (!transferBatch.signedBtcTransaction) {
            throw new Error("TransferBatch doesn't have signedBtcTransaction");
        }
        await this.btcMultisig.submitTransaction(transferBatch.signedBtcTransaction);
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

    private async getPendingTransferBatch(entityManager: EntityManager): Promise<TransferBatch|undefined> {
        const transferBatchRepository = entityManager.getRepository(StoredBitcoinTransferBatch);
        // TODO: optimize this a great deal -- don't want to go through every stored batch every tiem
        const storedBatches = await transferBatchRepository.find({
            order: {
                createdAt: 'ASC'
            }
        });
        for (let storedBatch of storedBatches) {
            const transferBatch = await this.loadFromDto(storedBatch.data as TransferBatchDTO);
            if (!transferBatch?.isMarkedAsMinedInRsk()) {
                return transferBatch;
            }
        }
        return undefined;
    }

    //private async getPendingStoredTransferBatches(entityManager: EntityManager): Promise<StoredBitcoinTransferBatch[]> {
    //    const transferBatchRepository = entityManager.getRepository(StoredBitcoinTransferBatch);
    //    const storedTransferBatches = await transferBatchRepository
    //        .createQueryBuilder('batch')
    //        .where(`batch->'data'->'status' < :statuses`)
    //        .setParameters({
    //            statuses: [
    //                TransferBatchStatus.Ready,
    //                TransferBatchStatus.SentStatusUpdatedToRSK
    //            ],
    //        })
    //        .getMany();
    //    if (storedTransferBatches.length === 0) {
    //        return [];
    //    }
    //    this.logger.info(`Found ${storedTransferBatches.length} stored transfer batches`)
    //    function compareByStatus(a: StoredBitcoinTransferBatch, b: StoredBitcoinTransferBatch) {
    //        if (a.data.status === b.data.status) {
    //            return 0;
    //        }
    //        if (a.data.status === b.data.status) {
    //            return -1;
    //        }
    //        return 1;
    //    }
    //    storedTransferBatches.sort(compareByStatus);
    //    return storedTransferBatches;
    //}
}

@injectable()
export class TransferBatchValidator {
    private logger = new Logger('transfer-batch-validator');

    constructor(
        @inject(BitcoinMultisig) private btcMultisig: BitcoinMultisig,
        @inject(Scanner) private eventScanner: EventScanner,
    ) {
    }

    async validateForSigningRskSentUpdate(transferBatch: TransferBatch): Promise<void> {
        if (transferBatch.transfers.length === 0) {
            throw new TransferBatchValidationError('Refusing to sign a batch without transfers');
        }
        await this.validateTransfers(transferBatch, TransferStatus.New);
        await this.validatePsbt(transferBatch, transferBatch.initialBtcTransaction);
        if (transferBatch.signedBtcTransaction) {
            await this.validatePsbt(transferBatch, transferBatch.signedBtcTransaction);
        }
    }

    async validateForSigningBitcoinTransaction(transferBatch: TransferBatch): Promise<void> {
        if (transferBatch.transfers.length === 0) {
            throw new TransferBatchValidationError('Refusing to sign a batch without transfers');
        }
        if (!transferBatch.hasEnoughRskSendingSignatures()) {
            throw new TransferBatchValidationError('Refusing to sign a batch without enough RSK signatures');
        }
        await this.validateTransfers(transferBatch, TransferStatus.New);
        await this.validatePsbt(transferBatch, transferBatch.initialBtcTransaction);
        if (transferBatch.signedBtcTransaction) {
            await this.validatePsbt(transferBatch, transferBatch.signedBtcTransaction);
        }
    }

    async validateCompleteTransferBatch(transferBatch: TransferBatch): Promise<void> {
        if (
            transferBatch.transfers.length == 0 ||
            !transferBatch.hasEnoughRskSendingSignatures() ||
            !transferBatch.hasEnoughBitcoinSignatures() ||
            !transferBatch.signedBtcTransaction
        ) {
            throw new TransferBatchValidationError('TransferBatch is not complete');
        }
        await this.validateTransfers(transferBatch, null);
        await this.validatePsbt(transferBatch, transferBatch.initialBtcTransaction);
        await this.validatePsbt(transferBatch, transferBatch.signedBtcTransaction);
    }

    private async validatePsbt(transferBatch: TransferBatch, psbt: PartiallySignedBitcoinTransaction) {
        const psbtTransfers = this.btcMultisig.getTransactionTransfers(psbt);

        if (psbtTransfers.length !== transferBatch.transfers.length) {
            throw new TransferBatchValidationError(
                `Transfer batch has ${transferBatch.transfers.length} transfers but the PSBT has ${psbtTransfers.length} transfers`
            );
        }

        if (transferBatch.bitcoinTransactionHash !== this.btcMultisig.getBitcoinTransactionHash(psbt)) {
            throw new TransferBatchValidationError(
                `TransferBatch bitcoin transaction hash doesn't match PSBT transaction hash`
            );
        }

        const seenDepositIds = new Map<string, boolean>();
        for (const psbtTransfer of psbtTransfers) {
            const transfer = transferBatch.getTransferByBitcoinAddressAndNonce(psbtTransfer.btcAddress, psbtTransfer.nonce);

            const depositId = `${psbtTransfer.btcAddress}/${psbtTransfer.nonce}`;

            if (!transfer) {
                throw new TransferBatchValidationError(
                    `Batch doesn't contain transfer ${depositId}`
                );
            }

            if (seenDepositIds.get(transfer.transferId)) {
                throw new TransferBatchValidationError(
                    `Deposit ${depositId} is in the PSBT more than once`
                );
            }

            seenDepositIds.set(transfer.transferId, true);
        }

        // TODO: validate signatures
    }

    private async validateTransfers(transferBatch: TransferBatch, expectedStatus: TransferStatus|null) {
        const seenTransferIds = new Map<string, boolean>();
        for (const transfer of transferBatch.transfers) {
            if (seenTransferIds.get(transfer.transferId)) {
                throw new TransferBatchValidationError(
                    `Transfer ${transfer} is in the batch more than once`
                );
            }
            seenTransferIds.set(transfer.transferId, true);

            const depositInfo = await this.eventScanner.fetchDepositInfo(transfer.btcAddress, transfer.nonce);

            // TODO: maybe we should compare amount - fees and not whole amount
            if (!transfer.totalAmountSatoshi.eq(depositInfo.totalAmountSatoshi)) {
                throw new TransferBatchValidationError(
                    `The transfer ${transfer} has ${depositInfo.totalAmountSatoshi} in RSK but ${transfer.totalAmountSatoshi} in proposed BTC batch`
                );
            }

            if (expectedStatus !== null && depositInfo.status != expectedStatus) {
                throw new TransferBatchValidationError(
                    `The RSK contract has invalid state for deposit ${transfer}; expected ${expectedStatus}, got ${depositInfo.status}`
                );
            }
        }
    }
}


function deepcopy<T = any>(thing: T): T {
    return JSON.parse(JSON.stringify(thing));
}
