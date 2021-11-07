import {inject, injectable, LazyServiceIdentifer} from 'inversify';
import {BitcoinMultisig, BitcoinRPCGetTransactionResponse, PartiallySignedBitcoinTransaction} from '../btc/multisig';
import {EthersProvider, EthersSigner, FastBtcBridgeContract} from '../rsk/base';
import {ethers} from 'ethers';
import {DBConnection} from '../db/connection';
import {Connection, EntityManager} from 'typeorm';
import {Config} from '../config';
import {StoredBitcoinTransferBatch, StoredBitcoinTransferBatchRepository, Transfer, TransferStatus} from '../db/models';
import {EventScanner, Scanner} from '../rsk/scanner';
import Logger from '../logger';
import {setExtend, setIntersection} from "../utils/sets";

type TransactionResponse = ethers.providers.TransactionResponse;


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
    bitcoinOnChainTransaction?: BitcoinRPCGetTransactionResponse;
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
        if (this.bitcoinTransactionHash !== dto.bitcoinTransactionHash) {
            throw new Error('TransferBatch bitcoinTransactionHash and DTO bitcoinTransactionHash do not match');
        }
        if (
            this.initialBtcTransaction.requiredSignatures !== dto.initialBtcTransaction.requiredSignatures ||
            this.initialBtcTransaction.serializedTransaction !== dto.initialBtcTransaction.serializedTransaction
        ) {
            throw new Error('TransferBatch initialBtcTransaction and DTO initialBtcTransaction do not match');
        }
        if (this.signedBtcTransaction && dto.signedBtcTransaction) {
            // It's possible that this has some mismatches. because of different number of signatures
            if (
                this.signedBtcTransaction.requiredSignatures !== dto.signedBtcTransaction.requiredSignatures
            ) {
                throw new Error('TransferBatch signedBtcTransaction and DTO signedBtcTransaction do not match');
            }
        }
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
            if (transfer.status !== TransferStatus.Sending && transfer.status !== TransferStatus.Mined) {
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
        const chainTx = this.environment.bitcoinOnChainTransaction;
        if (!chainTx) {
            return false;
        }
        // TODO: this should be configurable
        const requiredConfirmations = 1;
        return chainTx.confirmations >= requiredConfirmations;
    }

    isMarkedAsMinedInRsk(): boolean {
        for (const transfer of this.transfers) {
            if(transfer.status !== TransferStatus.Mined) {
                return false;
            }
        }
        return true;
    }

    isPending(): boolean {
        // TODO: should handle refunded and reclaimed
        return !this.isMarkedAsMinedInRsk();
    }
}

export class TransferBatchValidationError extends Error {
    isValidationError = true;
}
export type BitcoinTransferServiceConfig = Pick<
    Config,
    'numRequiredSigners' | 'maxPassedBlocksInBatch' | 'maxTransfersInBatch' | 'rskRequiredConfirmations'
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
            return new TransferBatch(
                await this.getTransferBatchEnvironment(bitcoinTxHash),  // TODO: could pass null here since it is not in blockchain
                transfers,
                rskUpdateSignatures,
                rskSigners,
                bitcoinTxHash,
                initialSignedBtcTransaction,
            );
        });
    }

    async loadFromDto(dto: TransferBatchDTO): Promise<TransferBatch|undefined> {
        // TODO: validation
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
                await this.getTransferBatchEnvironment(dto.bitcoinTransactionHash),
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
            await this.storeTransferBatch(transferBatch, transaction);
        });
    }

    private async storeTransferBatch(transferBatch: TransferBatch, entityManager: EntityManager): Promise<void> {
        const transferBatchRepository = entityManager.getCustomRepository(StoredBitcoinTransferBatchRepository);
        await transferBatchRepository.createOrUpdateFromTransferBatch(transferBatch.getDto());
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
        const seenPublicKeys = new Set<string>(transferBatchPsbt.signedPublicKeys);

        if (!seenPublicKeys.has(this.btcMultisig.getThisNodePublicKey())) {
            const thisNodePsbt = await this.btcMultisig.signTransaction(transferBatch.initialBtcTransaction);
            psbts.push(thisNodePsbt);
        }

        for (const psbt of psbts) {
            if (psbt.signedPublicKeys.length === 0) {
                this.logger.info('empty psbt, skipping');
                continue;
            }

            const seenIntersection = setIntersection(seenPublicKeys, new Set(psbt.signedPublicKeys));
            if (seenIntersection.size) {
                this.logger.info(`public keys ${[...seenIntersection]} have already signed`);
                continue;
            }

            setExtend(seenPublicKeys, psbt.signedPublicKeys);

            // TODO: validate key/signature
            validPsbts.push(psbt);
            if (seenPublicKeys.size === numRequired) {
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
            throw new Error('TransferBatch does not have enough signatures to be marked as sending');
        }
        await this.dbConnection.transaction(async transaction => {
            const transferBatchRepository = transaction.getCustomRepository(StoredBitcoinTransferBatchRepository);
            const transferRepository = transaction.getRepository(Transfer);
            this.logger.info('marking transfer batch', transferBatch, 'as sending in RSK');
            const result = await this.sendRskTransaction(
                () => this.fastBtcBridge.markTransfersAsSending(
                    `0x${transferBatch.bitcoinTransactionHash}`,
                    transferBatch.getTransferIds(),
                    transferBatch.rskUpdateSignatures
                )
            );
            this.logger.info('transfers successfully marked as sending in tx hash:', result.hash);
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
            `0x${transferBatch.bitcoinTransactionHash}`,
            transferBatch.getTransferIds(),
            TransferStatus.Sending
        );
        const signature = await this.ethersSigner.signMessage(ethers.utils.arrayify(updateHash));
        const address = await this.ethersSigner.getAddress();
        return {signature, address};
    };

    async sendToBitcoin(transferBatch: TransferBatch): Promise<void> {
        this.logger.info("Sending TransferBatch to bitcoin");
        if (!transferBatch.signedBtcTransaction) {
            throw new Error("TransferBatch doesn't have signedBtcTransaction");
        }
        await this.btcMultisig.submitTransaction(transferBatch.signedBtcTransaction);
        this.logger.info("TransferBatch successfully sent to bitcoin");
    }

    private async getTransferBatchEnvironment(bitcoinTransactionHash: string|null): Promise<TransferBatchEnvironment> {
        const currentBlockNumber = await this.ethersProvider.getBlockNumber();
        let bitcoinOnChainTransaction = undefined;
        if (bitcoinTransactionHash) {
            bitcoinOnChainTransaction = await this.btcMultisig.getTransaction(bitcoinTransactionHash);
        }
        return {
            currentBlockNumber,
            bitcoinOnChainTransaction,
            numRequiredSigners: this.config.numRequiredSigners,
            maxPassedBlocksInBatch: this.config.maxPassedBlocksInBatch,
            maxTransfersInBatch: this.config.maxTransfersInBatch,
        };
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
        this.logger.debug('Found', storedBatches.length, 'stored batches in total');
        for (let storedBatch of storedBatches) {
            const transferBatch = await this.loadFromDto(storedBatch.data as TransferBatchDTO);
            if (transferBatch!.isPending()) {
                //this.logger.debug('Pending:', transferBatch);
                return transferBatch;
            }
        }
        return undefined;
    }

    private async sendRskTransaction(sendTransaction: () => Promise<TransactionResponse>): Promise<TransactionResponse> {
        // TODO: Could do retrying etc here, but the logic in full is built to handle this situation
        // TODO: also this method doesn't belong in this class really
        const result = await sendTransaction();
        const numRequiredConfirmations = Math.max(
            1,
            Math.ceil(this.config.rskRequiredConfirmations / 2)
        );
        this.logger.info('tx hash:', result.hash, `waiting (${numRequiredConfirmations} confirms)...`);
        try {
            await result.wait(numRequiredConfirmations);
        } catch(e: any) {
            this.logger.exception(e, `RSK transaction ${result.hash} failed.`)
        }
        return result;
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
        await this.validateTransfers(transferBatch, TransferStatus.Sending);
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

        const seenDepositIds = new Set<string>();
        for (const psbtTransfer of psbtTransfers) {
            const transfer = transferBatch.getTransferByBitcoinAddressAndNonce(psbtTransfer.btcAddress, psbtTransfer.nonce);

            const depositId = `${psbtTransfer.btcAddress}/${psbtTransfer.nonce}`;

            if (!transfer) {
                throw new TransferBatchValidationError(
                    `Batch doesn't contain transfer ${depositId}`
                );
            }

            if (seenDepositIds.has(transfer.transferId)) {
                throw new TransferBatchValidationError(
                    `Deposit ${depositId} is in the PSBT more than once`
                );
            }

            seenDepositIds.add(transfer.transferId);
        }

        // TODO: validate signatures
    }

    private async validateTransfers(transferBatch: TransferBatch, expectedStatus: TransferStatus|null) {
        const seenTransferIds = new Set<string>();
        for (const transfer of transferBatch.transfers) {
            if (seenTransferIds.has(transfer.transferId)) {
                throw new TransferBatchValidationError(
                    `Transfer ${transfer} is in the batch more than once`
                );
            }
            seenTransferIds.add(transfer.transferId);

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
