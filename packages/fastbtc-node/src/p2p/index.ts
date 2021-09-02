import {interfaces} from 'inversify';
import Container = interfaces.Container;
import {Network, P2PNetwork, createNetwork} from './network';
import {Config} from '../config';

export function setupInversify(container: Container) {
    container.bind<Network>(P2PNetwork).toDynamicValue((context) => {
        return createNetwork(context.container.get<Config>(Config));
    }).inSingletonScope();
}
