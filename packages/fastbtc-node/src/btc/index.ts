import {interfaces} from 'inversify';
import {BitcoinMultisig} from './multisig';
import BitcoinNodeWrapper from './nodewrapper';
import {Config} from '../config';
import Container = interfaces.Container;

export function setupInversify(container: Container) {
    container.bind<BitcoinMultisig>(BitcoinMultisig).toSelf().inSingletonScope();
    container.bind<BitcoinNodeWrapper>(BitcoinNodeWrapper).toDynamicValue(
        (context) => {
            const config = context.container.get<Config>(Config);
            return new BitcoinNodeWrapper({
                url: config.btcRpcUrl,
                btcNetwork: config.btcNetwork,
                user: config.btcRpcUsername,
                password: config.secrets().btcRpcPassword,
            });
        },
    ).inSingletonScope();
}
