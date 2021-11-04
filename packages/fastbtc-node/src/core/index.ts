import {interfaces} from 'inversify';
import {FastBTCNode} from './node';
import {BitcoinTransferService} from './transfers';
import Container = interfaces.Container;

export function setupInversify(container: Container) {
    container.bind<FastBTCNode>(FastBTCNode).toSelf();
    container.bind<BitcoinTransferService>(BitcoinTransferService).toSelf();
}
