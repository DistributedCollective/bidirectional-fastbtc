import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const {deploy} = hre.deployments;
    const {deployer} = await hre.getNamedAccounts();
    const accessControl = await hre.deployments.get('FastBTCAccessControl');
    await deploy('BTCAddressValidator', {
        from: deployer,
        args: [accessControl.address],
        log: true,
    });
};
export default func;
