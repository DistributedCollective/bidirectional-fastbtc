import {inject, injectable} from 'inversify';
import {ethers} from 'ethers';
import {ConnectionProvider} from '../db/connection';
import {KeyValuePairRepository} from '../db/models';
import {EthersProvider, FastBtcBridgeContract} from './base';
import {Config} from '../config';

export const Scanner = Symbol.for('Scanner');

@injectable()
export class EventScanner {
    constructor(
        @inject(EthersProvider) private ethersProvider: ethers.providers.Provider,
        @inject(FastBtcBridgeContract) private fastBtcBridge: ethers.Contract,
        @inject(ConnectionProvider) private dbConnectionProvider: ConnectionProvider,
        @inject(Config) private config: Config,
    ) {
    }

    async scanNewEvents() {
        const currentBlock = await this.ethersProvider.getBlockNumber();
        (await this.dbConnectionProvider()).transaction(async dbConnection => {
            const keyValuePairRepository = dbConnection.getCustomRepository(KeyValuePairRepository);
            const lastProcessedBlock = await keyValuePairRepository.getOrCreateValue(
                'last-processed-block',
                this.config.rskStartBlock - 1
            );
            console.log("Current block is", currentBlock);
            console.log("Last processed block is", lastProcessedBlock);
        });
    }
}
