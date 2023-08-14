import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';

const validatorConfigs = {
    regtest: {
        bech32Prefix: "bcrt1q",
        nonBech32Prefixes: [
            //"m", // pubkey hash
            //"n", // pubkey hash
            //"2", // script hash
        ],
    },
    testnet: {
        bech32Prefix: "tb1q",
        nonBech32Prefixes: [
            //"m", // pubkey hash
            //"n", // pubkey hash
            //"2", // script hash
        ],
    },
    mainnet: {
        bech32Prefix: "bc1q",
        nonBech32Prefixes: [
            "1", // pubkey hash
            "3", // script hash
        ],
    },
}
type ValidatorConfig = typeof validatorConfigs.mainnet;

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    let validatorConfig: ValidatorConfig;
    if (hre.network.name === 'hardhat' || hre.network.name === 'localhost') {
        console.log(`Using regtest config for BTCAddressValidator because network is ${hre.network.name}`);
        validatorConfig = validatorConfigs.regtest;
    } else if (hre.network.name === 'rsk-testnet') {
        console.log('Using testnet config for BTCAddressValidator because network is rsk-testnet');
        validatorConfig = validatorConfigs.testnet;
    } else if (hre.network.name === 'rsk') {
        console.log('Using mainnet config for BTCAddressValidator because network is rsk (mainnet)');
        validatorConfig = validatorConfigs.mainnet;
    } else {
        console.warn(`Unknown network ${hre.network.name}, falling back to mainnet BTCAddressValidator config`);
        validatorConfig = validatorConfigs.mainnet;
    }

    const {deploy} = hre.deployments;
    const {deployer} = await hre.getNamedAccounts();
    const accessControl = await hre.deployments.get('FastBTCAccessControl');
    await deploy('BTCAddressValidator', {
        from: deployer,
        args: [accessControl.address, validatorConfig.bech32Prefix, validatorConfig.nonBech32Prefixes],
        log: true,
    });
};
export default func;
