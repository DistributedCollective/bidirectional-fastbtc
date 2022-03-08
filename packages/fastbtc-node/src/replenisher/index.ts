import {interfaces} from 'inversify';
import {BitcoinReplenisher, ActualBitcoinReplenisher, NullBitcoinReplenisher} from './replenisher';
import {Config} from '../config';
import Container = interfaces.Container;
import {BitcoinMultisig} from '../btc/multisig';
import {P2PNetwork} from '../p2p/network';
import {Network} from 'ataraxia';

export function setupInversify(container: Container) {
    container.bind<BitcoinReplenisher>(BitcoinReplenisher).toDynamicValue(
        (context) => {
            const config = context.container.get<Config>(Config);
            const replenisherConfig = config.replenisherConfig;
            if (!replenisherConfig) {
                return new NullBitcoinReplenisher();
            } else {
                const bitcoinMultisig = context.container.get<BitcoinMultisig>(BitcoinMultisig);
                const network = context.container.get<Network>(P2PNetwork);
                return new ActualBitcoinReplenisher(
                    replenisherConfig,
                    bitcoinMultisig,
                    network,
                )
            }
        },
    ).inSingletonScope();
}
