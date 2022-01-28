import {ethers, Contract} from 'ethers';
import fastBtcBridgeAbi from './abi/FastBTCBridge.json';
import {interfaces} from 'inversify';
import Container = interfaces.Container;
import {Config} from '../config';
type Provider = ethers.providers.Provider;

export const EthersProvider = Symbol.for('EthersProvider');
export const EthersSigner = Symbol.for('EthersSigner');
export const FastBtcBridgeContract = Symbol.for('FastBtcBridgeContract');

export const bindAllToContainer = (container: Container) => {
    container.bind<Provider>(EthersProvider).toDynamicValue((context) => {
        const config = context.container.get<Config>(Config);
        return new ethers.providers.JsonRpcProvider(config.rskRpcUrl);
    })

    container.bind<ethers.Signer>(EthersSigner).toDynamicValue((context) => {
        const config = context.container.get<Config>(Config);
        const provider = context.container.get<Provider>(EthersProvider);
        return new ethers.Wallet(config.secrets().rskPrivateKey, provider);
    })

    container.bind<Contract>(FastBtcBridgeContract).toDynamicValue((context) => {
        const config = context.container.get<Config>(Config);
        const signer = context.container.get<Provider>(EthersSigner);
        return new ethers.Contract(config.rskContractAddress, fastBtcBridgeAbi, signer);
    })
}
