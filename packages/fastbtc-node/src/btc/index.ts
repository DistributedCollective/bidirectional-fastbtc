import {interfaces} from 'inversify';
import Container = interfaces.Container;
import {BitcoinMultisig} from './multisig';
import BitcoinNodeWrapper from './nodewrapper';
import {createNetwork} from '../p2p/network';
import {Config} from '../config';
import {ethers} from 'ethers';
import {EthersSigner, FastBtcBridgeContract} from '../rsk/base';

export function setupInversify(container: Container) {
    container.bind<BitcoinMultisig>(BitcoinMultisig).toSelf();
    container.bind<BitcoinNodeWrapper>(BitcoinNodeWrapper).toDynamicValue(
        (context) => {
            const config = context.container.get<Config>(Config);
            return new BitcoinNodeWrapper({
                url: config.btcRpcUrl,
                user: config.btcRpcUsername,
                password: config.btcRpcPassword,
            });
        },
    );
}
