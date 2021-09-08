import {inject, injectable} from 'inversify';
import {ethers} from 'ethers';
import {DBConnection} from '../db/connection';
import {KeyValuePairRepository, Transfer, TransferStatus} from '../db/models';
import {EthersProvider, FastBtcBridgeContract} from './base';
import {Config} from '../config';
import {Connection} from 'typeorm';
import {getEvents} from './utils';

export const Scanner = Symbol.for('Scanner');

const LAST_PROCESSED_BLOCK_KEY = 'eventscanner-last-processed-block';

@injectable()
export class EventScanner {
    private defaultStartBlock: number;
    private requiredConfirmations: number;
    private logger = console;

    constructor(
        @inject(EthersProvider) private ethersProvider: ethers.providers.Provider,
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
        if(toBlock < fromBlock) {
            this.logger.debug(`toBlock ${toBlock} is smaller than fromBlock ${fromBlock}, aborting`)
            return [];
        }

        const events = await getEvents(
            this.fastBtcBridge,
            this.fastBtcBridge.filters.Transferred(),
            fromBlock,
            toBlock,
        );

        return await this.dbConnection.transaction(async db => {
            const keyValuePairRepository = db.getCustomRepository(KeyValuePairRepository);
            const transferRepository = db.getRepository(Transfer);

            const transfers: Transfer[] = [];
            for(let event of events) {
                // TODO: validate that transfer is not already in DB
                const args = event.args;
                if(!args) {
                    this.logger.warn('Event has no args', event);
                    continue;
                }
                // TODO: store rsk address in event so we don't have to get the tx for each event
                const tx = await event.getTransaction();
                const transfer = transferRepository.create({
                    status: TransferStatus.New,
                    btcAddress: args._btcAddress, // TODO: normalize bitcoin address
                    nonce: args._nonce.toNumber(),
                    amountSatoshi: args._amountSatoshi,
                    feeSatoshi: args._feeSatoshi,
                    rskAddress: tx.from, // TODO: should get from args
                    rskTransactionHash: event.transactionHash,
                    rskTransactionIndex: event.transactionIndex,
                    rskLogIndex: event.logIndex,
                    rskBlockNumber: event.blockNumber,
                    btcTransactionHash: '',
                });
                transfers.push(transfer);
            }
            if(transfers.length) {
                await transferRepository.save(transfers);
            }

            await keyValuePairRepository.setValue(LAST_PROCESSED_BLOCK_KEY, toBlock + 1);
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
}
