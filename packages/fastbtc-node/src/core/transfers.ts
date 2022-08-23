/**
 * This module contains the main business logic
 */
import {inject, injectable, LazyServiceIdentifer} from 'inversify';
import {BitcoinMultisig, BitcoinRPCGetTransactionResponse, PartiallySignedBitcoinTransaction} from '../btc/multisig';
import {EthersProvider, EthersSigner, FastBtcBridgeContract} from '../rsk/base';
import {BigNumber, Contract, ethers} from 'ethers';
import {DBConnection} from '../db/connection';
import {Connection, EntityManager} from 'typeorm';
import {Config} from '../config';
import {StoredBitcoinTransferBatchRepository, Transfer, TransferStatus} from '../db/models';
import Logger from '../logger';
import {sleep} from '../utils';
import {setExtend, setIntersection} from "../utils/sets";
import {toNumber} from '../rsk/utils';
import {Satoshis} from '../btc/types';

// For lack of a better place, just have these here
export const MAX_BTC_IN_BATCH = 5.0;
export const MAX_SATOSHI_IN_BATCH = BigNumber.from(MAX_BTC_IN_BATCH * 1e8);

type TransactionResponse = ethers.providers.TransactionResponse;


// NOTE: if the TransferBatchDTO interface is changed in a backwards-incompatible way,
// we need to handle versioning, because it's also stored in DB.

export interface TransferBatchDTO {
    transferIds: string[];
    rskSendingSignatures: string[];
    rskSendingSigners: string[];
    bitcoinTransactionHash: string;
    initialBtcTransaction: PartiallySignedBitcoinTransaction;
    signedBtcTransaction?: PartiallySignedBitcoinTransaction;
    rskMinedSignatures: string[];
    rskMinedSigners: string[];
}

export interface TransferBatchEnvironment {
    numRequiredSigners: number;
    maxPassedBlocksInBatch: number;
    maxTransfersInBatch: number;
    currentBlockNumber: number;
    requiredBitcoinConfirmations: number;
    requiredRskConfirmations: number;
    bitcoinOnChainTransaction?: BitcoinRPCGetTransactionResponse;
}

/**
 * A batch of transfers from RSK to Bitcoin, with associated signatures, Bitcoin transaction data and so on
 */
export class TransferBatch {
    constructor(
        private environment: TransferBatchEnvironment,
        public transfers: Transfer[],
        public rskSendingSignatures: string[],
        public rskSendingSigners: string[],
        public bitcoinTransactionHash: string,
        public initialBtcTransaction: PartiallySignedBitcoinTransaction,
        public signedBtcTransaction: PartiallySignedBitcoinTransaction|undefined,
        public rskMinedSignatures: string[],
        public rskMinedSigners: string[],
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
            rskSendingSignatures: this.rskSendingSignatures,
            rskSendingSigners: this.rskSendingSigners,
            bitcoinTransactionHash: this.bitcoinTransactionHash,
            initialBtcTransaction: this.initialBtcTransaction,
            signedBtcTransaction: this.signedBtcTransaction,
            rskMinedSignatures: this.rskMinedSignatures,
            rskMinedSigners: this.rskMinedSigners,
        }
    }

    toJson(): string {
        return JSON.stringify(this.getDto());
    }

    copy(): TransferBatch {
        return new TransferBatch(
            deepcopy(this.environment),
            [...this.transfers],
            [...this.rskSendingSignatures],
            [...this.rskSendingSigners],
            this.bitcoinTransactionHash,
            deepcopy(this.initialBtcTransaction),
            this.signedBtcTransaction ? deepcopy(this.signedBtcTransaction) : undefined,
            [...this.rskMinedSignatures],
            [...this.rskMinedSigners],
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
        // We only see blocks up to the required block confirmations,
        // which needs to be taken into account here to wait for the passed blocks correctly
        const currentBlockWithConfirmations = this.environment.currentBlockNumber - this.environment.requiredRskConfirmations;
        const passedBlocks = currentBlockWithConfirmations - firstTransferBlock;
        return passedBlocks >= this.environment.maxPassedBlocksInBatch;
    }

    hasEnoughRskSendingSignatures(): boolean {
        return this.rskSendingSignatures.length >= this.environment.numRequiredSigners;
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

    bitcoinSignatureCount(): number {
        const psbt = this.signedBtcTransaction;
        return psbt ? psbt.signedPublicKeys.length : 0;
    }

    isSentToBitcoin(): boolean {
        const chainTx = this.environment.bitcoinOnChainTransaction;
        if (!chainTx) {
            return false;
        }
        return chainTx.confirmations >= this.environment.requiredBitcoinConfirmations;
    }

    hasEnoughRskMinedSignatures(): boolean {
        return this.rskMinedSignatures.length >= this.environment.numRequiredSigners;
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
        return !this.isFinalized();
    }

    isFinalized(): boolean {
        return this.isMarkedAsMinedInRsk();
    }

    hasValidTransferState(): boolean {
        // Transfer batches should only contain transfers that all have the same status,
        // and that status should be New, Sending or Mined (not refunded)
        if (this.transfers.length === 0) {
            return true; // technically
        }
        const validStatuses = [TransferStatus.New, TransferStatus.Sending, TransferStatus.Mined];
        const seenStatuses = new Set<TransferStatus>();
        for (const transfer of this.transfers) {
            if (validStatuses.indexOf(transfer.status) === -1) {
                return false;
            }
            seenStatuses.add(transfer.status);
        }

        return seenStatuses.size === 1;
    }
}

export type BitcoinTransferServiceConfig = Pick<
    Config,
    'numRequiredSigners' | 'maxPassedBlocksInBatch' | 'maxTransfersInBatch' | 'rskRequiredConfirmations' | 'btcRequiredConfirmations'
>

export interface ReclaimedTransfersFoundResult {
    reclaimedTransfersFound: true;
    reclaimedTransferIds: string[];
    purgedDto: TransferBatchDTO;
    newTransferBatch?: TransferBatch;
}
export interface ReclaimedTransfersNotFoundResult {
    reclaimedTransfersFound: false;
}
export type HandleReclaimedTransfersResult = ReclaimedTransfersFoundResult | ReclaimedTransfersNotFoundResult;

/**
 * The main business logic service. Contains methods to manipulate and create TransferBatches, sign actions (RSK or
 * Bitcoin transactions) and so on.
 */
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
            return await this.createTransferBatch(transfers);
        });
    }

    async loadFromDto(dto: TransferBatchDTO): Promise<TransferBatch|undefined> {
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
                dto.rskSendingSignatures,
                dto.rskSendingSigners,
                dto.bitcoinTransactionHash,
                dto.initialBtcTransaction,
                dto.signedBtcTransaction,
                dto.rskMinedSignatures,
                dto.rskMinedSigners,
            );
        });
    }

    async updateStoredTransferBatch(transferBatch: TransferBatch): Promise<void> {
        await this.dbConnection.transaction(async transaction => {
            await this.storeTransferBatch(transferBatch, transaction);
        });
    }

    async purgeTransferBatch(transferBatch: TransferBatch): Promise<void> {
        // allow purging if blockchain state does not match
        const isValid = await this.validator.hasValidState(transferBatch);
        if (isValid) {
            throw new Error('refusing to purge a valid transfer batch');
        }
        await this.dbConnection.transaction(async transaction => {
            const transferBatchRepository = transaction.getCustomRepository(StoredBitcoinTransferBatchRepository);
            const storedBatch = await transferBatchRepository.findByTransferIds(transferBatch.getTransferIds());
            if (storedBatch) {
                await transferBatchRepository.remove(storedBatch);
            }
        });
    }

    /**
     * If TransferBatch contains transfers that are reclaimed in the latest block of the blockchain, purge the batch.
     * and create (and store) a new batch with those transfers removed, if there are other valid transfers in the batch.
     *
     * We continue with the same TransferBatch with just those transfers removed, if possible, to prevent griefing
     * attacks where someone constantly creates and reclaims transfers. This could otherwise halt the system if we
     * were to take in other transfers to the batch (though I'm not 100% sure if that's a real issue).
     *
     * Return an object that describes what was done here, and that can be used to communicate the purging to other
     * clients.
     */
    async handleReclaimedTransfers(transferBatch: TransferBatch): Promise<HandleReclaimedTransfersResult> {
        const originalTransferIds = transferBatch.transfers.map(t => t.transferId);
        const blockchainTransfers: RskTransferInfo[] = await this.fastBtcBridge.getTransfersByTransferId(originalTransferIds);

        const reclaimedTransfers = [];
        const validTransfers = [];

        for (let i = 0; i < blockchainTransfers.length; i++) {
            const transfer = transferBatch.transfers[i];
            const blockchainTransfer = blockchainTransfers[i];

            if (blockchainTransfer.status === TransferStatus.Reclaimed) {
                reclaimedTransfers.push(transfer);
            } else {
                validTransfers.push(transfer);
            }
        }

        if (!reclaimedTransfers.length) {
            return {
                reclaimedTransfersFound: false,
            };
        }

        const reclaimedTransferIds = reclaimedTransfers.map(t => t.transferId);
        this.logger.info( 'TransferBatch has reclaimed transfers:', reclaimedTransferIds);

        const ret: ReclaimedTransfersFoundResult = {
            reclaimedTransfersFound: true,
            purgedDto: transferBatch.getDto(),
            reclaimedTransferIds,
        }

        this.logger.info('Purging the TransferBatch');
        await this.purgeTransferBatch(transferBatch);

        if (validTransfers.length === 0) {
            this.logger.info(
                'No valid transfers in TransferBatch after removing the reclaimed ones'
            );
            return ret;
        }

        this.logger.info('Creating and storing a new TransferBatch based on the existing transfers');
        const newBatch = await this.createTransferBatch(validTransfers);
        await this.updateStoredTransferBatch(newBatch);
        ret.newTransferBatch = newBatch;
        return ret;
    }

    private async storeTransferBatch(transferBatch: TransferBatch, entityManager: EntityManager): Promise<void> {
        const transferBatchRepository = entityManager.getCustomRepository(StoredBitcoinTransferBatchRepository);
        await transferBatchRepository.createOrUpdateFromTransferBatch(
            transferBatch.getDto(),
            {
                markFinalized: transferBatch.isFinalized(),
            }
        );
    }

    async addRskSendingSignatures(transferBatch: TransferBatch, signaturesAndAddresses: {signature: string, address: string}[]): Promise<TransferBatch> {
        if (signaturesAndAddresses.length === 0) {
            return transferBatch;
        }
        if (transferBatch.isMarkedAsSendingInRsk()) {
            this.logger.info(`not adding any more signatures to a transfer batch that's already marked as sending`);
            return transferBatch;
        }
        transferBatch  = transferBatch.copy();
        let updated = false;
        const updateHash = await getUpdateHashForSending(this.fastBtcBridge, transferBatch);
        for(const {address, signature} of signaturesAndAddresses) {
            const existingSigners = transferBatch.rskSendingSigners.map(a => a.toLowerCase());
            if (existingSigners.indexOf(address.toLowerCase()) !== -1) {
                this.logger.info(`address ${address} has already signed`);
                continue;
            }
            if (transferBatch.hasEnoughRskSendingSignatures()) {
                this.logger.info(`transfer batch has enough rsk sent signatures`);
                continue;
            }
            if (!await this.validator.isValidSignatureAndAddress(updateHash, signature, address)) {
                this.logger.warning(`signature does not match address or not a federator: ${address} ${signature}`);
                continue;
            }
            updated = true;
            transferBatch.rskSendingSignatures = [...transferBatch.rskSendingSignatures, signature];
            transferBatch.rskSendingSigners = [...transferBatch.rskSendingSigners, address];
        }
        if (transferBatch.rskSendingSigners.length === this.config.numRequiredSigners - 1) {
            updated = true;
            const {signature, address} = await this.signRskSendingUpdate(transferBatch);
            transferBatch.rskSendingSignatures = [...transferBatch.rskSendingSignatures, signature];
            transferBatch.rskSendingSigners = [...transferBatch.rskSendingSigners, address];
        }
        if (updated) {
            await this.updateStoredTransferBatch(transferBatch);
        }
        return transferBatch;
    }

    async addRskMinedSignatures(transferBatch: TransferBatch, signaturesAndAddresses: {signature: string, address: string}[]): Promise<TransferBatch> {
        if (signaturesAndAddresses.length === 0) {
            return transferBatch;
        }
        if (transferBatch.isMarkedAsMinedInRsk()) {
            this.logger.info(`not adding any more signatures to a transfer batch that's already marked as mined`);
            return transferBatch;
        }
        transferBatch  = transferBatch.copy();
        let updated = false;
        const updateHash = await getUpdateHashForMined(this.fastBtcBridge, transferBatch);
        for(const {address, signature} of signaturesAndAddresses) {
            const existingSigners = transferBatch.rskMinedSigners.map(a => a.toLowerCase());
            if (existingSigners.indexOf(address.toLowerCase()) !== -1) {
                this.logger.info(`address ${address} has already signed`);
                continue;
            }
            if (transferBatch.hasEnoughRskMinedSignatures()) {
                this.logger.info(`transfer batch has enough rsk sent signatures`);
                continue;
            }
            if (!await this.validator.isValidSignatureAndAddress(updateHash, signature, address)) {
                this.logger.warning(`signature does not match address or not a federator: ${address} ${signature}`);
                continue;
            }
            updated = true;
            transferBatch.rskMinedSignatures = [...transferBatch.rskMinedSignatures, signature];
            transferBatch.rskMinedSigners = [...transferBatch.rskMinedSigners, address];
        }
        if (transferBatch.rskMinedSigners.length === this.config.numRequiredSigners - 1) {
            updated = true;
            const {signature, address} = await this.signRskMinedUpdate(transferBatch);
            transferBatch.rskMinedSignatures = [...transferBatch.rskMinedSignatures, signature];
            transferBatch.rskMinedSigners = [...transferBatch.rskMinedSigners, address];
        }
        if (updated) {
            await this.updateStoredTransferBatch(transferBatch);
        }
        return transferBatch;
    }

    async addBitcoinSignatures(transferBatch: TransferBatch, psbts: PartiallySignedBitcoinTransaction[]): Promise<TransferBatch> {
        // combine should do validation here
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
        if (transferBatch.isMarkedAsSendingInRsk()) {
            throw new Error('TransferBatch is already marked as sending in rsk');
        }
        await this.dbConnection.transaction(async transaction => {
            const transferBatchRepository = transaction.getCustomRepository(StoredBitcoinTransferBatchRepository);
            const transferRepository = transaction.getRepository(Transfer);
            this.logger.info('marking transfer batch as sending in RSK');
            const result = await this.sendRskTransaction(
                () => this.fastBtcBridge.markTransfersAsSending(
                    `0x${transferBatch.bitcoinTransactionHash}`,
                    transferBatch.getTransferIds(),
                    transferBatch.rskSendingSignatures
                )
            );
            this.logger.info('transfers successfully marked as sending in tx hash:', result.hash);
            // XXX: not sure if we should just skip local updates
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

    async markAsMinedInRsk(transferBatch: TransferBatch): Promise<void> {
        if (!transferBatch.hasEnoughRskMinedSignatures()) {
            throw new Error('TransferBatch does not have enough signatures to be marked as mined');
        }
        if (transferBatch.isMarkedAsMinedInRsk()) {
            throw new Error('TransferBatch is already marked as mined in rsk');
        }
        await this.dbConnection.transaction(async transaction => {
            const transferBatchRepository = transaction.getCustomRepository(StoredBitcoinTransferBatchRepository);
            const transferRepository = transaction.getRepository(Transfer);
            this.logger.info('marking transfer batch as mined in RSK');
            const result = await this.sendRskTransaction(
                () => this.fastBtcBridge.markTransfersAsMined(
                    transferBatch.getTransferIds(),
                    transferBatch.rskMinedSignatures
                )
            );
            this.logger.info('transfers successfully marked as mined in tx hash:', result.hash);
            // XXX: not sure if we should just skip local updates
            const transfers = await Promise.all(
                transferBatch.getTransferIds().map(
                    transferId => transferRepository.findOneOrFail({
                        where: {transferId},
                    })
                )
            );
            for (const transfer of transfers) {
                transfer.status = TransferStatus.Mined;
            }
            await transferRepository.save(transfers);
            await transferBatchRepository.createOrUpdateFromTransferBatch(transferBatch.getDto());
        });
    }

    async signRskSendingUpdate(transferBatch: TransferBatch): Promise<{signature: string, address: string}> {
        if (transferBatch.transfers.length === 0) {
            throw new Error("Refusing to sign empty transfer batch");
        }
        await this.validator.validateForSigningRskSendingUpdate(transferBatch);
        const updateHash = await getUpdateHashForSending(this.fastBtcBridge, transferBatch);
        const signature = await this.ethersSigner.signMessage(ethers.utils.arrayify(updateHash));
        const address = await this.ethersSigner.getAddress();
        return {signature, address};
    };

    async signBitcoinTransaction(transferBatch: TransferBatch): Promise<PartiallySignedBitcoinTransaction> {
        await this.validator.validateForSigningBitcoinTransaction(transferBatch);
        return this.btcMultisig.signTransaction(transferBatch.initialBtcTransaction);
    }

    async sendToBitcoin(transferBatch: TransferBatch): Promise<void> {
        this.logger.info("Sending TransferBatch to bitcoin");
        await this.validator.validateForSendingToBitcoin(transferBatch);
        if (transferBatch.isSentToBitcoin()) {
            this.logger.info("TransferBatch is already sent to bitcoin");
            return;
        }
        if (!transferBatch.signedBtcTransaction) {
            throw new Error("TransferBatch doesn't have signedBtcTransaction");
        }
        await this.btcMultisig.submitTransaction(transferBatch.signedBtcTransaction);
        this.logger.info("TransferBatch successfully sent to bitcoin");

        // This method should be idempotent, but we will still wait for the required number of confirmations.
        const requiredConfirmations = this.config.btcRequiredConfirmations;
        const maxIterations = 200;
        const avgBlockTimeMs = 10 * 60 * 1000;
        const overheadMultiplier = 2;
        const sleepTimeMs = Math.round((avgBlockTimeMs * requiredConfirmations * overheadMultiplier) / maxIterations);
        this.logger.info(`Waiting for ${requiredConfirmations} confirmations`);
        for (let i = 0; i < maxIterations; i++) {
            const chainTx = await this.btcMultisig.getTransaction(transferBatch.bitcoinTransactionHash);
            const confirmations = chainTx ? chainTx.confirmations : 0;
            if (confirmations >= requiredConfirmations) {
                break;
            }
            await sleep(sleepTimeMs);
        }
    }

    async signRskMinedUpdate(transferBatch: TransferBatch): Promise<{signature: string, address: string}> {
        if (transferBatch.transfers.length === 0) {
            throw new Error("Refusing to sign empty transfer batch");
        }
        await this.validator.validateForSigningRskMinedUpdate(transferBatch);
        const updateHash = await getUpdateHashForMined(this.fastBtcBridge, transferBatch);
        const signature = await this.ethersSigner.signMessage(ethers.utils.arrayify(updateHash));
        const address = await this.ethersSigner.getAddress();
        return {signature, address};
    };

    private async createTransferBatch(transfers: Transfer[]): Promise<TransferBatch> {
        // we don't really need to create the PSBT every time, but the overhead doesn't really matter
        const initialSignedBtcTransaction = await this.btcMultisig.createPartiallySignedTransaction(transfers);
        const bitcoinTxHash = this.btcMultisig.getBitcoinTransactionHash(
            initialSignedBtcTransaction
        );
        return new TransferBatch(
            await this.getTransferBatchEnvironment(bitcoinTxHash),  // could also null here since it is not in blockchain
            transfers,
            [],
            [],
            bitcoinTxHash,
            initialSignedBtcTransaction,
            undefined,
            [],
            [],
        );
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
            requiredBitcoinConfirmations: this.config.btcRequiredConfirmations,
            requiredRskConfirmations: this.config.rskRequiredConfirmations,
            numRequiredSigners: this.config.numRequiredSigners,
            maxPassedBlocksInBatch: this.config.maxPassedBlocksInBatch,
            maxTransfersInBatch: this.config.maxTransfersInBatch,
        };
    }

    private async getNextBatchTransfers(entityManager: EntityManager): Promise<Transfer[]> {
        const transferRepository = entityManager.getRepository(Transfer);
        const allPossibleTransfers = await transferRepository
            .createQueryBuilder("transfer")
            .where({
                status: TransferStatus.New,
            })
            .orderBy('rsk_block_number', 'ASC')
            .addOrderBy('rsk_transaction_index', 'ASC')
            .addOrderBy('rsk_log_index', 'ASC')
            .take(this.config.maxTransfersInBatch)
            .getMany();

        let totalSatoshiInBatch = BigNumber.from(0);
        const filteredTransfers: Transfer[] = [];
        for(let transfer of allPossibleTransfers) {
            // NOTE: to account for fees, we sum totalAmountSatoshi and not amountSatoshi
            let totalSatoshiInBatchWithTransfer = totalSatoshiInBatch.add(transfer.totalAmountSatoshi);
            if (totalSatoshiInBatchWithTransfer.gt(MAX_SATOSHI_IN_BATCH)) {
                this.logger.info(
                    `Adding transfer ${transfer.transferId} to the batch would bring the total batch satoshi ` +
                    `to ${totalSatoshiInBatchWithTransfer.toString()}, which is over the limit ${MAX_SATOSHI_IN_BATCH.toString()}. ` +
                    `Cutting the batch short (with ${totalSatoshiInBatch.toString()} sat).`
                );
                break;
            }
            totalSatoshiInBatch = totalSatoshiInBatchWithTransfer;
            filteredTransfers.push(transfer);
        }
        return filteredTransfers;
    }

    private async getPendingTransferBatch(entityManager: EntityManager): Promise<TransferBatch|undefined> {
        const transferBatchRepository = entityManager.getCustomRepository(StoredBitcoinTransferBatchRepository);
        const storedBatches = await transferBatchRepository.find({
            where:{
                finalized: false,
            },
            order: {
                createdAt: 'ASC'
            }
        });
        this.logger.debug('Found', storedBatches.length, 'stored batches in total');
        for (let storedBatch of storedBatches) {
            const transferBatch = await this.loadFromDto(storedBatch.data as TransferBatchDTO);
            if (transferBatch!.isFinalized()) {
                this.logger.info("marking transfer batch as finalized");
                await transferBatchRepository.createOrUpdateFromTransferBatch(
                    transferBatch!.getDto(),
                    {
                        markFinalized: true,
                    }
                );
            } else if (transferBatch!.isPending()) {
                //this.logger.debug('Pending:', transferBatch);
                return transferBatch;
            }
        }
        return undefined;
    }

    private async sendRskTransaction(sendTransaction: () => Promise<TransactionResponse>): Promise<TransactionResponse> {
        // We could do retrying etc here, but the logic in full is built to handle this situation
        // This method doesn't also really belong in this class (there should be another service), but it's good
        // enough for now
        const result = await sendTransaction();
        // Wait for numRequiredConfirmations + 1 so that other nodes have a chance to catch up (decreases
        // false positive errors in logs)
        const numRequiredConfirmations = Math.max(
            1,
            this.config.rskRequiredConfirmations + 1
        );
        this.logger.info('tx hash:', result.hash, `waiting (${numRequiredConfirmations} confirms)...`);
        try {
            await result.wait(numRequiredConfirmations);
        } catch(e: any) {
            //this.logger.exception(e, `RSK transaction ${result.hash} failed.`)
            this.logger.error(`RSK transaction ${result.hash} failed.`)
            throw e;
        }
        return result;
    }
}

export class TransferBatchValidationError extends Error {
    isValidationError = true;
}

interface RskTransferInfo {
    rskAddress: string;
    status: TransferStatus;
    nonce: number;
    feeStructureIndex: number;
    blockNumber: number;
    totalAmountSatoshi: Satoshis;
    btcAddress: string;
}

export type TransferBatchValidatorConfig = Pick<
    Config,
    'rskRequiredConfirmations'
>

/**
 * This service is responsible for TransferBatch validation logic
 */
@injectable()
export class TransferBatchValidator {
    private logger = new Logger('transfer-batch-validator');

    constructor(
        @inject(BitcoinMultisig) private btcMultisig: BitcoinMultisig,
        @inject(EthersProvider) private ethersProvider: ethers.providers.Provider,
        @inject(FastBtcBridgeContract) private fastBtcBridge: ethers.Contract,
        @inject(Config) private config: TransferBatchValidatorConfig,
    ) {
    }

    async validateForSigningRskSendingUpdate(transferBatch: TransferBatch): Promise<void> {
        await this.validateRskStatusUpdate(transferBatch, TransferStatus.New);
    }

    async validateForSigningRskMinedUpdate(transferBatch: TransferBatch): Promise<void> {
        if (!transferBatch.isSentToBitcoin()) {
            throw new TransferBatchValidationError('Refusing to sign a batch that has not been sent to bitcoin yet');
        }
        await this.validateRskStatusUpdate(transferBatch, TransferStatus.Sending);
    }

    private async validateRskStatusUpdate(transferBatch: TransferBatch, expectedCurrentStatus: TransferStatus): Promise<void> {
        await this.validateTransferBatch(transferBatch, expectedCurrentStatus, false);
    }

    async validateForSigningBitcoinTransaction(transferBatch: TransferBatch): Promise<void> {
        if (transferBatch.transfers.length === 0) {
            throw new TransferBatchValidationError('Refusing to sign a batch without transfers');
        }
        // Not necessary if it's already Sending
        //if (!transferBatch.hasEnoughRskSendingSignatures()) {
        //    throw new TransferBatchValidationError('Refusing to sign a batch without enough RSK signatures');
        //}
        if (!transferBatch.isMarkedAsSendingInRsk()) {
            throw new TransferBatchValidationError('Refusing to sign a batch that is not marked as sending');
        }
        await this.validateTransferBatch(transferBatch, TransferStatus.Sending, false);
    }

    async validateForSendingToBitcoin(transferBatch: TransferBatch): Promise<void> {
        if (
            transferBatch.transfers.length == 0 ||
            //!transferBatch.hasEnoughRskSendingSignatures() ||
            !transferBatch.hasEnoughBitcoinSignatures() ||
            !transferBatch.isMarkedAsSendingInRsk() ||
            !transferBatch.signedBtcTransaction
        ) {
            throw new TransferBatchValidationError('TransferBatch is not sendable to bitcoin');
        }
        await this.validateTransferBatch(transferBatch, null, true);
    }

    async validateCompleteTransferBatch(transferBatch: TransferBatch): Promise<void> {
        if (
            transferBatch.transfers.length == 0 ||
            //!transferBatch.hasEnoughRskSendingSignatures() ||
            //!transferBatch.hasEnoughBitcoinSignatures() ||
            //!transferBatch.hasEnoughRskMinedSignatures() ||
            // We should probably validate that all transfers are mined instead of just sending, but it's possible
            // that that state is not yet reflected in the transfers. So let's just roll with this now.
            !transferBatch.isMarkedAsSendingInRsk() ||
            // Or maybe we'll do this
            (!transferBatch.hasEnoughRskMinedSignatures() && !transferBatch.isMarkedAsMinedInRsk()) ||
            !transferBatch.isSentToBitcoin() ||
            !transferBatch.signedBtcTransaction
        ) {
            throw new TransferBatchValidationError('TransferBatch is not complete');
        }
        await this.validateTransferBatch(transferBatch, null, true);
    }

    public async isValidSignatureAndAddress(
        hashedMessage: string,
        signature: string,
        address: string
    ): Promise<boolean> {
        const federators = await this.fastBtcBridge.federators();
        if (federators.indexOf(address) === -1) {
            this.logger.debug(
                `address ${address} is not a federator`
            );
        }
        const recovered = recoverAddressFromMessageHash(hashedMessage, signature);
        if (recovered !== address) {
            this.logger.debug(
                `recovered address ${recovered} does not match address ${address}`
            )
            return false;
        }
        return true;
    }

    /**
     * Validate both local TransferBatch state and the state of the transfers on blockchain
     */
    public async hasValidState(
        transferBatch: TransferBatch,
        allowEmpty: boolean = false
    ): Promise<boolean> {
        if (transferBatch.transfers.length === 0 && !allowEmpty) {
            return false;
        }
        if (!transferBatch.hasValidTransferState()) {
            return false;
        }

        if (transferBatch.transfers.length > 0) {
            const transferIds = transferBatch.getTransferIds();
            const transferInfos: RskTransferInfo[] = await this.fastBtcBridge.getTransfersByTransferId(transferIds);
            for (let i = 0; i < transferInfos.length; i++) {
                const batchTransfer = transferBatch.transfers[i];
                const batchStatus = batchTransfer.status;
                const blockchainStatus = transferInfos[i].status;
                if (batchStatus !== blockchainStatus) {
                    this.logger.info(
                        "hasValidState: status from blockchain %s doesn't match stored status %s for transfer %s",
                        blockchainStatus, batchStatus, batchTransfer.transferId
                    );
                    return false;
                }
            }
        }

        return true;
    }

    private async validateTransferBatch(
        transferBatch: TransferBatch,
        expectedStatus: TransferStatus|null,
        requireSignedBtcTransaction: boolean
    ): Promise<void> {
        if (!transferBatch.hasValidTransferState()) {
            throw new TransferBatchValidationError(
                'TransferBatch has an invalid transfer state'
            );
        }
        await this.validateTransfers(transferBatch, expectedStatus);
        await this.validateRskSignatures(transferBatch);
        await this.validatePsbt(transferBatch, transferBatch.initialBtcTransaction);
        if (transferBatch.signedBtcTransaction) {
            await this.validatePsbt(transferBatch, transferBatch.signedBtcTransaction);
        } else if (requireSignedBtcTransaction) {
            throw new TransferBatchValidationError(
                'TransferBatch is missing signedBtcTransaction'
            );
        }
    }

    private async validateRskSignatures(transferBatch: TransferBatch): Promise<void> {
        const federators = await this.fastBtcBridge.federators();
        if (transferBatch.rskSendingSignatures.length > 0) {
            const updateHash = await getUpdateHashForSending(this.fastBtcBridge, transferBatch);
            await this.validateSignatureAndAddresses(
                'sending:',
                updateHash,
                federators,
                transferBatch.rskSendingSignatures,
                transferBatch.rskSendingSigners
            )
        }
        if (transferBatch.rskMinedSignatures.length > 0) {
            const updateHash = await getUpdateHashForMined(this.fastBtcBridge, transferBatch);
            await this.validateSignatureAndAddresses(
                'mined:',
                updateHash,
                federators,
                transferBatch.rskMinedSignatures,
                transferBatch.rskMinedSigners
            )
        }
    }

    private async validateSignatureAndAddresses(
        prefix: string,
        hashedMessage: string,
        federators: string[],
        signatures: string[],
        addresses: string[]
    ): Promise<void> {
        if (signatures.length !== addresses.length) {
            throw new TransferBatchValidationError(
                `${prefix} signatures length differs from addresses length`
            );
        }
        if (signatures.length > 0) {
            const seen = new Set<string>();
            for (let i = 0; i < signatures.length; i++) {
                const signature = signatures[i];
                const address = addresses[i];
                if (seen.has(address.toLowerCase())) {
                    throw new TransferBatchValidationError(
                        `${prefix} address ${address} has signed more than once`
                    );
                }
                seen.add(address.toLowerCase());
                if (federators.indexOf(address) === -1) {
                    throw new TransferBatchValidationError(
                        `${prefix} address ${address} is not a federator`
                    );
                }
                const recovered = recoverAddressFromMessageHash(hashedMessage, signature);
                if (recovered !== address) {
                    throw new TransferBatchValidationError(
                        `${prefix} recovered address ${recovered} does not match address ${address}`
                    );
                }
            }
        }
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

        // would be good to validate signatures here but it seems it's tricky until the tx is finalized
    }

    private async validateTransfers(transferBatch: TransferBatch, expectedStatus: TransferStatus|null) {
        const seenTransferIds = new Set<string>();
        for (const transfer of transferBatch.transfers) {
            if (seenTransferIds.has(transfer.transferId)) {
                throw new TransferBatchValidationError(
                    `Transfer ${transfer.transferId} is in the batch more than once`
                );
            }
            seenTransferIds.add(transfer.transferId);

            const depositInfo = await this.fetchRskTransferInfo(transfer.btcAddress, transfer.nonce);

            // maybe we should compare amount - fees and not whole amount
            if (!transfer.totalAmountSatoshi.eq(depositInfo.totalAmountSatoshi)) {
                throw new TransferBatchValidationError(
                    `The transfer ${transfer.transferId} has ${depositInfo.totalAmountSatoshi} in RSK but ${transfer.totalAmountSatoshi} in proposed BTC batch`
                );
            }

            if (expectedStatus !== null && depositInfo.status != expectedStatus) {
                throw new TransferBatchValidationError(
                    `The RSK contract has invalid state for deposit ${transfer.transferId}; expected ${expectedStatus}, got ${depositInfo.status}`
                );
            }
        }
    }

    private async fetchRskTransferInfo(btcPaymentAddress: string, nonce: number): Promise<RskTransferInfo> {
        const currentBlock = await this.ethersProvider.getBlockNumber();
        const transferData = await this.fastBtcBridge.getTransfer(btcPaymentAddress, nonce);
        const nBlocksBeforeData = await this.fastBtcBridge.getTransfer(
            btcPaymentAddress,
            nonce,
            {
                blockTag: currentBlock - this.config.rskRequiredConfirmations
            }
        );

        const transfer: RskTransferInfo = {
            ...transferData,
            nonce: toNumber(transferData.nonce),
            status: toNumber(transferData.status),
        };
        const nBlocksBefore: RskTransferInfo = {
            ...nBlocksBeforeData,
            nonce: toNumber(nBlocksBeforeData.nonce),
        };

        if (
            transfer.btcAddress !== nBlocksBefore.btcAddress ||
            transfer.nonce !== nBlocksBefore.nonce ||
            transfer.totalAmountSatoshi !== nBlocksBefore.totalAmountSatoshi ||
            transfer.feeStructureIndex !== nBlocksBefore.feeStructureIndex ||
            transfer.rskAddress !== nBlocksBefore.rskAddress
        ) {
            throw new TransferBatchValidationError(
                `The transaction data ${JSON.stringify(transferData, null, 2)} does not match the one ` +
                `${this.config.rskRequiredConfirmations} blocks before ${JSON.stringify(nBlocksBeforeData, null, 2)} `
            );
        }

        return transfer;
    }
}

// A couple of shared utility functions, here for a lack of a better place

// Recover address bytes32 hash given as 0x prefixed string
function recoverAddressFromMessageHash(hash: string, signature: string): string {
    return ethers.utils.verifyMessage(ethers.utils.arrayify(hash), signature);
}

async function getUpdateHashForSending(fastBtcBridge: Contract, transferBatch: TransferBatch): Promise<string> {
    return await fastBtcBridge.getTransferBatchUpdateHashWithTxHash(
        `0x${transferBatch.bitcoinTransactionHash}`,
        transferBatch.getTransferIds(),
        TransferStatus.Sending
    );
}

async function getUpdateHashForMined(fastBtcBridge: Contract, transferBatch: TransferBatch): Promise<string> {
    return await fastBtcBridge.getTransferBatchUpdateHash(
        transferBatch.getTransferIds(),
        TransferStatus.Mined
    );
}

function deepcopy<T = any>(thing: T): T {
    return JSON.parse(JSON.stringify(thing));
}
