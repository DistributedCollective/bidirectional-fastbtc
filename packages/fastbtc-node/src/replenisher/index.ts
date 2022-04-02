import {interfaces} from 'inversify';
import {ActualBitcoinReplenisher, BitcoinReplenisher, NullBitcoinReplenisher} from './replenisher';
import {Config} from '../config';
import {BitcoinMultisig} from '../btc/multisig';
import {P2PNetwork} from '../p2p/network';
import {Network} from 'ataraxia';
import {TYPES} from '../stats';
import {StatsD} from 'hot-shots';
import {ReplenisherMultisig} from './replenishermultisig';
import Container = interfaces.Container;

export function setupInversify(container: Container) {
    container.bind<BitcoinReplenisher>(BitcoinReplenisher).toDynamicValue(
        (context) => {
            const config = context.container.get<Config>(Config);
            const replenisherConfig = config.replenisherConfig;
            if (!replenisherConfig) {
                return new NullBitcoinReplenisher();
            } else {
                const statsd = context.container.get<StatsD>(TYPES.StatsD);
                const bitcoinMultisig = context.container.get<BitcoinMultisig>(BitcoinMultisig);
                const network = context.container.get<Network>(P2PNetwork);
                const replenisherMultisig = new ReplenisherMultisig(replenisherConfig, bitcoinMultisig, statsd);
                return new ActualBitcoinReplenisher(
                    replenisherConfig,
                    bitcoinMultisig,
                    network,
                    replenisherMultisig,
                )
            }
        },
    ).inSingletonScope();
}
