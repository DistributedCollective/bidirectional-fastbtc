// Deploying utility contracts -- only on local network
import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    if(hre.network.name !== 'hardhat') {
        console.log('Skipping utility contract deployment because network is not hardhat');
        return;
    }
    const {deploy} = hre.deployments;
    const {deployer} = await hre.getNamedAccounts();
    await deploy('Multicall2', {
        from: deployer,
        args: [],
        log: true,
    });
};
export default func;
