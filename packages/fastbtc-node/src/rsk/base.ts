import {ethers, Contract} from 'ethers';
import fastBtcBridgeAbi from './abi/FastBTCBridge.json';
import {interfaces} from 'inversify';
import Container = interfaces.Container;
import {Config} from '../config';
type Provider = ethers.providers.Provider;

export const EthersProvider = Symbol.for('Provider');
export const FastBtcBridgeContract = Symbol.for('FastBtcBridgeContract');

export const bindAllToContainer = (container: Container) => {
    container.bind<Provider>(EthersProvider).toDynamicValue((context) => {
        const config = context.container.get<Config>(Config);
        return new ethers.providers.JsonRpcProvider(config.rskRpcUrl);
    })

    container.bind<Contract>(FastBtcBridgeContract).toDynamicValue((context) => {
        const config = context.container.get<Config>(Config);
        const provider = context.container.get<Provider>(EthersProvider);
        return new ethers.Contract(config.rskContractAddress, fastBtcBridgeAbi, provider);
    })
}
