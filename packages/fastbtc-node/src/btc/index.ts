import {interfaces} from 'inversify';
import Container = interfaces.Container;
import {BitcoinMultisig} from './multisig';

export function setupInversify(container: Container) {
    container.bind<BitcoinMultisig>(BitcoinMultisig).toSelf()
}
