import {interfaces} from 'inversify';
import {FastBTCNode} from './node';
import {BitcoinTransferService, TransferBatchValidator} from './transfers';
import Container = interfaces.Container;

export function setupInversify(container: Container) {
    container.bind<FastBTCNode>(FastBTCNode).toSelf();
    container.bind<BitcoinTransferService>(BitcoinTransferService).toSelf();
    container.bind<TransferBatchValidator>(TransferBatchValidator).toSelf();
}
