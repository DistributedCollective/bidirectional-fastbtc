//import {Contract} from '@usedapp/core/node_modules/@ethersproject/contracts';
import {Contract} from 'ethers';
import {Interface} from 'ethers/lib/utils';
import LocalFastBTCBridge from './deployments/localhost/FastBTCBridge.json';
import LocalMulticall from './deployments/localhost/Multicall2.json';

let networkName = process.env.REACT_APP_NETWORK || 'local';
if (networkName !== 'local' && networkName !== 'testnet' && networkName !== 'mainnet') {
    console.error(`Invalid network: ${networkName}, reverting to local`)
    networkName = 'local';
}

const multicallAbi = new Interface(LocalMulticall.abi);
const fastbtcAbi = new Interface(LocalFastBTCBridge.abi);

export let configuredChainId: number;
export let multicall: Contract;
export let fastbtcBridge: Contract;

if (networkName === 'testnet') {
    configuredChainId = 31;
    multicall = new Contract('0x9e469e1fc7fb4c5d17897b68eaf1afc9df39f103', multicallAbi);
    fastbtcBridge = new Contract('0xfd4994c50c6bb2417d2e6ed0056bf9c871116d29', fastbtcAbi);
} else if (networkName === 'mainnet') {
    configuredChainId = 30;
    multicall = new Contract('0x6c62bf5440de2cb157205b15c424bceb5c3368f5', multicallAbi);
    // TODO: mainnet contract
    fastbtcBridge = new Contract('0x0000000000000000000000000000000000000000', fastbtcAbi);
} else {
    configuredChainId = 31337;
    multicall = new Contract(LocalMulticall.address, multicallAbi);
    fastbtcBridge = new Contract(LocalFastBTCBridge.address, fastbtcAbi);
}
