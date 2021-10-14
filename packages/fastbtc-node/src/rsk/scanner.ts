import {inject, injectable} from 'inversify';
import {BigNumber, ethers} from 'ethers';
import {DBConnection} from '../db/connection';
import {KeyValuePairRepository, Transfer, TransferStatus} from '../db/models';
import {EthersProvider, EthersSigner, FastBtcBridgeContract} from './base';
import {Config} from '../config';
import {Connection} from 'typeorm';
import {getEvents} from './utils';
import {Satoshis} from "../btc/types";

export const Scanner = Symbol.for('Scanner');

const LAST_PROCESSED_BLOCK_KEY = 'eventscanner-last-processed-block';

interface RskTransferInfo {
    btcAddress: string;
    nonce: number;
    amountSatoshi: Satoshis;
    feeSatoshi: Satoshis;
    rskAddress: string;
    status: TransferStatus;
}

// TODO: the name might be a misnomer since this does quite a few things beside scanning for new events
@injectable()
export class EventScanner {
    private defaultStartBlock: number;
    private requiredConfirmations: number;
    private logger = console;

    constructor(
        @inject(EthersProvider) private ethersProvider: ethers.providers.Provider,
        @inject(EthersSigner) private ethersSigner: ethers.Signer,
        @inject(FastBtcBridgeContract) private fastBtcBridge: ethers.Contract,
        @inject(DBConnection) private dbConnection: Connection,
        @inject(Config) private config: Config,
    ) {
        this.defaultStartBlock = config.rskStartBlock;
        this.requiredConfirmations = config.rskRequiredConfirmations;
    }

    async getCurrentBlockNumber(): Promise<number> {
        return await this.ethersProvider.getBlockNumber();
    }

    async scanNewEvents(): Promise<Transfer[]> {
        // TODO: we should obtain a lock maybe
        const currentBlock = await this.ethersProvider.getBlockNumber();
        this.logger.debug("Current rsk block is", currentBlock);

        let lastProcessedBlock = await this.dbConnection.transaction(async db => {
            const keyValuePairRepository = db.getCustomRepository(KeyValuePairRepository);
            return await keyValuePairRepository.getOrCreateValue(
                LAST_PROCESSED_BLOCK_KEY,
                this.defaultStartBlock - 1
            );
        });

        this.logger.debug("Last processed block is", lastProcessedBlock);
        let fromBlock = lastProcessedBlock + 1;
        const toBlock = currentBlock - this.requiredConfirmations;
        if (toBlock < fromBlock) {
            this.logger.debug(`toBlock ${toBlock} is smaller than fromBlock ${fromBlock}, aborting`)
            return [];
        }

        const events = await getEvents(
            this.fastBtcBridge,
            [
                this.fastBtcBridge.filters.NewTransfer(),
                this.fastBtcBridge.filters.TransferStatusUpdated(),
            ],
            fromBlock,
            toBlock,
        );

        return await this.dbConnection.transaction(async db => {
            const keyValuePairRepository = db.getCustomRepository(KeyValuePairRepository);
            const transferRepository = db.getRepository(Transfer);

            const transfers: Transfer[] = [];
            const transfersByTransferId: Record<string, Transfer> = {};

            for (let event of events) {
                const args = event.args;
                if (!args) {
                    this.logger.warn('Event has no args', event);
                    continue;
                }

                if (event.event === 'NewTransfer') {
                    this.logger.debug('NewTransfer', args._transferId);

                    // TODO: validate that transfer is not already in DB
                    const transfer = transferRepository.create({
                        transferId: args._transferId,
                        status: TransferStatus.New,
                        btcAddress: args._btcAddress,
                        nonce: args._nonce.toNumber(),
                        amountSatoshi: args._amountSatoshi,
                        feeSatoshi: args._feeSatoshi,
                        rskAddress: args._rskAddress,
                        rskTransactionHash: event.transactionHash,
                        rskTransactionIndex: event.transactionIndex,
                        rskLogIndex: event.logIndex,
                        rskBlockNumber: event.blockNumber,
                        btcTransactionHash: '',
                    });
                    transfers.push(transfer);
                    transfersByTransferId[transfer.transferId] = transfer;
                } else if (event.event === 'TransferStatusUpdated') {
                    const transferId = args._transferId as string;
                    const newStatus = (args._newStatus as BigNumber).toNumber();
                    this.logger.debug('TransferStatusUpdated', transferId, newStatus, TransferStatus[newStatus]);

                    // Transfer created just now
                    let transfer: Transfer = transfersByTransferId[transferId];
                    if (!transfer) {
                        // Transfer created earlier
                        transfer = await transferRepository.findOneOrFail({
                            where: {
                                transferId,
                            }
                        });

                        transfer.status = newStatus;

                        transfers.push(transfer);
                        transfersByTransferId[transfer.transferId] = transfer;
                    }

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

    async getNextBatchTransfers(maxBatchSize: number): Promise<Transfer[]> {
        const transferRepository = this.dbConnection.getRepository(Transfer);
        return transferRepository.find({
            where: {
                status: TransferStatus.New,
            },
            order: {
                // TODO: order by (blockNumber, transactionIndex, logIndex) would be better
                dbId: 'ASC',
            },
            take: maxBatchSize,
        })
    }

    async updateLocalTransferStatus(
        transfers: Transfer[] | string[],
        newStatus: TransferStatus
    ): Promise<Transfer[]> {
        const transferIds = this.getTransferIds(transfers);

        return await this.dbConnection.transaction(async db => {
            const transferRepository = db.getRepository(Transfer);
            const transfersToUpdate = await transferRepository.find({
                where: transferIds.map(transferId => ({
                    transferId
                }))
            });
            if (transfersToUpdate.length !== transferIds.length) {
                throw new Error('not all transfers with ids found: ' + transferIds.join(', '));
            }
            for (let transfer of transfersToUpdate) {
                transfer.status = newStatus;
            }
            await transferRepository.save(transfersToUpdate);
            return transfersToUpdate;
        });
    }

    async getNumTransfers(): Promise<number> {
        const transferRepository = this.dbConnection.getRepository(Transfer);
        return transferRepository.count();
    }

    async markTransfersAsSent(
        transfers: Transfer[] | string[],
        signatures: string[],
    ): Promise<void> {
        const transferIds = this.getTransferIds(transfers);
        const tx = await this.fastBtcBridge.markTransfersAsSent(
            transferIds,
            signatures,
        );
        this.logger.debug('markTransfersAsSent tx hash', tx.hash);
        const receipt = await tx.wait();
        if (receipt.status !== 1) {
            this.logger.error('Invalid status for markTransfersAsSent receipt', receipt);
            throw new Error('invalid status for markTransfersAsSent receipt');
        }
    }

    async fetchDepositInfo(btcPaymentAddress: string, nonce: number): Promise<RskTransferInfo> {
        const currentBlock = await this.ethersProvider.getBlockNumber();
        const transferData = await this.fastBtcBridge.getTransfer(btcPaymentAddress, nonce);
        const nBlocksBeforeData = await this.fastBtcBridge.getTransfer(
            btcPaymentAddress, nonce,
            {blockTag: currentBlock - this.requiredConfirmations}
        );

        const transfer: Transfer = {...transferData, nonce: transferData.nonce.toNumber(), status: transferData.status.toNumber()};
        const nBlocksBefore: Transfer = {...nBlocksBeforeData, nonce: nBlocksBeforeData.nonce.toNumber()};

        if (
            transfer.btcAddress !== nBlocksBefore.btcAddress ||
            transfer.nonce !== nBlocksBefore.nonce ||
            !transfer.amountSatoshi.eq(nBlocksBefore.amountSatoshi) ||
            !transfer.feeSatoshi.eq(nBlocksBefore.feeSatoshi) ||
            transfer.rskAddress !== nBlocksBefore.rskAddress
        ) {
            throw new Error(`The transaction data does not match the one ${this.requiredConfirmations} blocks before`);
        }

        return transfer;
    }

    async signTransferStatusUpdate(
        transfers: Transfer[] | string[],
        newStatus: TransferStatus
    ): Promise<string> {
        const transferIds = this.getTransferIds(transfers);
        const updateHash = await this.fastBtcBridge.getTransferBatchUpdateHash(transferIds, newStatus);
        return await this.ethersSigner.signMessage(ethers.utils.arrayify(updateHash));
    }

    private getTransferIds(
        transfers: Transfer[] | string[]
    ): string[] {
        return transfers.map(t => (
            (typeof t === 'string') ? t : t.transferId
        ));
    }
}
