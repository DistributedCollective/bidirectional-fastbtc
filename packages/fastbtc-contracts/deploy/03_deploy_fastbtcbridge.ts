import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const {deploy} = hre.deployments;
    const {deployer} = await hre.getNamedAccounts();
    const accessControl = await hre.deployments.get('FastBTCAccessControl');
    const btcAddressValidator = await hre.deployments.get('BTCAddressValidator');
    const deployResult = await deploy('FastBTCBridge', {
        from: deployer,
        args: [accessControl.address, btcAddressValidator.address],
        log: true,
    });

    if (hre.network.name === 'hardhat' && deployResult.newlyDeployed) {
        console.log("Initializing FastBTCBridge contract on hardhat network");
        const contract = await hre.ethers.getContractAt('FastBTCBridge', deployResult.address);
        // initialize it
        const tx = await contract.markReady();
        await tx.wait();
    }
};
export default func;
