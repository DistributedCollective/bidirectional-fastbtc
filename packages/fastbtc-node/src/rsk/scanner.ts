/**
 * Logic related to updating state from RSK
 */
import {inject, injectable} from 'inversify';
import {BigNumber, ethers} from 'ethers';
import {DBConnection} from '../db/connection';
import {KeyValuePairRepository, Transfer, TransferStatus, TransferBatchCommitment} from '../db/models';
import {EthersProvider, FastBtcBridgeContract} from './base';
import {Config} from '../config';
import {Connection} from 'typeorm';
import {getEvents, toNumber} from './utils';
import Logger from '../logger';
import {BitcoinMultisig} from "../btc/multisig";

export const Scanner = Symbol.for('Scanner');

const LAST_PROCESSED_BLOCK_KEY = 'eventscanner-last-processed-block';

export function getTransferId(btcAddress: string, nonce: number): string {
    return ethers.utils.solidityKeccak256(
        ['string', 'string', 'string', 'uint256'],
        ['transfer:', btcAddress, ':', nonce]
    );
}

/**
 * This class is responsible for reading events from RSK and keeping the database up-to-date with them.
 */
@injectable()
export class EventScanner {
    private defaultStartBlock: number;
    private requiredConfirmations: number;
    private logger = new Logger("scanner");

    constructor(
        @inject(EthersProvider) private ethersProvider: ethers.providers.Provider,
        @inject(FastBtcBridgeContract) private fastBtcBridge: ethers.Contract,
        @inject(DBConnection) private dbConnection: Connection,
        @inject(Config) private config: Config,
        @inject(BitcoinMultisig) private multisig: BitcoinMultisig
    ) {
        this.defaultStartBlock = config.rskStartBlock;
        this.multisig = multisig;
        this.requiredConfirmations = config.rskRequiredConfirmations;
    }

    /**
     * Read events (new transfers and transfer status updates) from RSK and update database.
     * A number of confirmations is always waited before accepting any event.
     */
    async scanNewEvents(): Promise<Transfer[]> {
        // would be good to lock here so that this could not be run if it's already running
        // as of now, the caller is responsible for this
        const currentBlock = await this.ethersProvider.getBlockNumber();

        let lastProcessedBlock = await this.dbConnection.transaction(async db => {
            const keyValuePairRepository = db.getCustomRepository(KeyValuePairRepository);
            return await keyValuePairRepository.getOrCreateValue(
                LAST_PROCESSED_BLOCK_KEY,
                this.defaultStartBlock - 1
            );
        });

        this.logger.debug("Current rsk block: %s; last processed block: %s", currentBlock, lastProcessedBlock);

        let fromBlock = lastProcessedBlock + 1;
        const toBlock = currentBlock - this.requiredConfirmations;
        if (toBlock < fromBlock) {
            this.logger.debug(`toBlock ${toBlock} is smaller than fromBlock ${fromBlock}, aborting`)
            return [];
        }

        const events = await getEvents(
            this.fastBtcBridge,
            [
                this.fastBtcBridge.filters.NewBitcoinTransfer(),
                this.fastBtcBridge.filters.BitcoinTransferStatusUpdated(),
                this.fastBtcBridge.filters.BitcoinTransferBatchSending(),
            ],
            fromBlock,
            toBlock,
        );

        return await this.dbConnection.transaction(async db => {
            const keyValuePairRepository = db.getCustomRepository(KeyValuePairRepository);
            const transferRepository = db.getRepository(Transfer);
            const transferBatchCommitmentRepository = db.getRepository(TransferBatchCommitment);

            const transfers: Transfer[] = [];
            const transfersByTransferId: Record<string, Transfer> = {};

            for (let event of events) {
                const args = event.args;
                if (!args) {
                    this.logger.warn('Event has no args', event);
                    continue;
                }

                if (event.event === 'NewBitcoinTransfer') {
                    this.logger.debug('NewBitcoinTransfer', args.transferId);

                    let status = TransferStatus.New;

                    // mark any transfer with wrong btc address as invalid
                    if (! this.multisig.validateAddress(args.btcAddress)) {
                        status = TransferStatus.Invalid;
                        this.logger.error(`Invalid BTC deposit address ${args.btcAddress} in transfer ${args.transferId}`);
                    }

                    // TODO: validate that transfer is not already in DB
                    const transfer = transferRepository.create({
                        transferId: args.transferId,
                        status: status,
                        btcAddress: args.btcAddress,
                        nonce: toNumber(args.nonce),
                        amountSatoshi: BigNumber.from(args.amountSatoshi),
                        feeSatoshi: BigNumber.from(args.feeSatoshi),
                        rskAddress: args.rskAddress,
                        rskTransactionHash: event.transactionHash,
                        rskTransactionIndex: event.transactionIndex,
                        rskLogIndex: event.logIndex,
                        rskBlockNumber: event.blockNumber,
                        btcTransactionHash: '',
                    });

                    transfers.push(transfer);
                    transfersByTransferId[transfer.transferId] = transfer;
                } else if (event.event === 'BitcoinTransferStatusUpdated') {
                    const transferId = args.transferId as string;
                    const newStatus = toNumber(args.newStatus);
                    this.logger.debug('BitcoinTransferStatusUpdated', transferId, newStatus, TransferStatus[newStatus]);

                    // Transfer created just now
                    let transfer: Transfer = transfersByTransferId[transferId];
                    if (!transfer) {
                        // Transfer created earlier
                        transfer = await transferRepository.findOneOrFail({
                            where: {
                                transferId,
                            }
                        });

                        transfers.push(transfer);
                        transfersByTransferId[transfer.transferId] = transfer;
                    }

                    transfer.status = newStatus;
                } else if (event.event === 'BitcoinTransferBatchSending') {
                    let btcTransactionHash = args.bitcoinTxHash as string;
                    // The BTC tx hashes we store don't generally start with 0x,
                    // because BTC doesn't follow that convention. RSK does, however.
                    if (btcTransactionHash.startsWith('0x')) {
                        btcTransactionHash = btcTransactionHash.slice(2);
                    }
                    const transferBatchSize = args.transferBatchSize as number;
                    this.logger.debug('BitcoinTransferBatchSending', btcTransactionHash, transferBatchSize);

                    // could double-check it's not already in DB. But this would cause a db error anyway
                    const commitment = transferBatchCommitmentRepository.create({
                        btcTransactionHash: btcTransactionHash,
                        transferBatchSize: transferBatchSize,
                        rskTransactionHash: event.transactionHash,
                        rskTransactionIndex: event.transactionIndex,
                        rskLogIndex: event.logIndex,
                        rskBlockNumber: event.blockNumber,
                        rskBlockHash: event.blockHash,
                    });
                    await transferBatchCommitmentRepository.save(commitment);
                } else {
                    this.logger.error('Unknown event:', event);
                }
            }

            if (transfers.length) {
                await transferRepository.save(transfers);
            }

            await keyValuePairRepository.setValue(LAST_PROCESSED_BLOCK_KEY, toBlock);
            return transfers;
        });
    }

    async getNumTransfers(): Promise<number> {
        const transferRepository = this.dbConnection.getRepository(Transfer);
        return transferRepository.count();
    }

    async getTransferById(transferId: string): Promise<Transfer> {
        const transferRepository = this.dbConnection.getRepository(Transfer);
        return transferRepository.findOneOrFail({where: {transferId, }});
    }
}
