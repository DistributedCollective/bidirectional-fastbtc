import {interfaces} from 'inversify';
import {FastBTCNode} from './node';
import {BitcoinTransferService, TransferBatchValidator} from './transfers';
import StatusChecker from './statuschecker';
import {CPFPBumper} from './cpfp';
import Container = interfaces.Container;

export function setupInversify(container: Container) {
    container.bind<FastBTCNode>(FastBTCNode).toSelf().inSingletonScope();
    container.bind<BitcoinTransferService>(BitcoinTransferService).toSelf().inSingletonScope();
    container.bind<TransferBatchValidator>(TransferBatchValidator).toSelf().inSingletonScope();
    container.bind<StatusChecker>(StatusChecker).toSelf().inSingletonScope();
    container.bind<CPFPBumper>(CPFPBumper).toSelf().inSingletonScope();
}
