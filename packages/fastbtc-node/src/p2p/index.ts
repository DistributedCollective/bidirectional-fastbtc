import {interfaces} from 'inversify';
import {createNetwork, Network, P2PNetwork} from './network';
import {Config} from '../config';
import {EthersSigner} from "../rsk/base";
import {ethers} from "ethers";
import Container = interfaces.Container;

export function setupInversify(container: Container) {
    container.bind<Network>(P2PNetwork).toDynamicValue((context) => {
        return createNetwork(
            context.container.get<Config>(Config),
            context.container.get<ethers.Signer>(EthersSigner),
        );
    }).inSingletonScope();
}
