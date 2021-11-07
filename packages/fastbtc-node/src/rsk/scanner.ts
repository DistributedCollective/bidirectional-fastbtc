import {inject, injectable} from 'inversify';
import {BigNumber, ethers} from 'ethers';
import {DBConnection} from '../db/connection';
import {KeyValuePairRepository, Transfer, TransferStatus} from '../db/models';
import {EthersProvider, FastBtcBridgeContract} from './base';
import {Config} from '../config';
import {Connection} from 'typeorm';
import {getEvents, toNumber} from './utils';
import {Satoshis} from "../btc/types";
import Logger from '../logger';

export const Scanner = Symbol.for('Scanner');

const LAST_PROCESSED_BLOCK_KEY = 'eventscanner-last-processed-block';

interface RskTransferInfo {
    rskAddress: string;
    status: TransferStatus;
    nonce: number;
    feeStructureIndex: number;
    blockNumber: number;
    totalAmountSatoshi: Satoshis;
    btcAddress: string;
}

export function getTransferId(btcAddress: string, nonce: number): string {
    return ethers.utils.solidityKeccak256(
        ['string', 'string', 'string', 'uint256'],
        ['transfer:', btcAddress, ':', nonce]
    );
}

// TODO: the name might be a misnomer since this does quite a few things beside scanning for new events
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
    ) {
        this.defaultStartBlock = config.rskStartBlock;
        this.requiredConfirmations = config.rskRequiredConfirmations;
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
                this.fastBtcBridge.filters.NewBitcoinTransfer(),
                this.fastBtcBridge.filters.BitcoinTransferStatusUpdated(),
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

                if (event.event === 'NewBitcoinTransfer') {
                    this.logger.debug('NewBitcoinTransfer', args.transferId);

                    // TODO: validate that transfer is not already in DB
                    const transfer = transferRepository.create({
                        transferId: args.transferId,
                        status: TransferStatus.New,
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

    async getNumTransfers(): Promise<number> {
        const transferRepository = this.dbConnection.getRepository(Transfer);
        return transferRepository.count();
    }

    async fetchDepositInfo(btcPaymentAddress: string, nonce: number): Promise<RskTransferInfo> {
        const currentBlock = await this.ethersProvider.getBlockNumber();
        const transferData = await this.fastBtcBridge.getTransfer(btcPaymentAddress, nonce);
        const nBlocksBeforeData = await this.fastBtcBridge.getTransfer(
            btcPaymentAddress,
            nonce,
            {
                blockTag: currentBlock - this.requiredConfirmations
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
            throw new Error(`The transaction data does not match the one ${this.requiredConfirmations} blocks before`);
        }

        return transfer;
    }

    private getTransferIds(
        transfers: (Transfer | string)[]
    ): string[] {
        return transfers.map(t => (
            (typeof t === 'string') ? t : t.transferId
        ));
    }

    async getTransferById(transferId: string): Promise<Transfer> {
        const transferRepository = this.dbConnection.getRepository(Transfer);
        return transferRepository.findOneOrFail({where: {transferId, }});
    }
}
