import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const {deploy} = hre.deployments;
    const {deployer} = await hre.getNamedAccounts();

    let receiverAddress;
    if (hre.network.name === 'hardhat') {
        // Just use some random address here, it doesn't matter
        receiverAddress = '0x0000000000000000000000000000000000001337';
    } else if (hre.network.name === 'rsk') {
        // mainnet ManagedWallet
        receiverAddress = '0xE43cafBDd6674DF708CE9DFF8762AF356c2B454d';
    } else if (hre.network.name === 'rsk-testnet') {
        // testnet ManagedWallet
        receiverAddress = '0xACBE05e7236F7d073295C99E629620DA58284AaD'
    } else {
        throw new Error(`Unknown network: ${hre.network.name}`);
    }

    console.log(`Deploying Withdrawer contract with receiver (ManagedWallet) ${receiverAddress}`);

    const fastBtcBridgeDeployment = await hre.deployments.get('FastBTCBridge');
    const result = await deploy('Withdrawer', {
        from: deployer,
        args: [fastBtcBridgeDeployment.address, receiverAddress],
        log: true,
    });

    if (result.newlyDeployed) {
        const accessControlDeployment = await hre.deployments.get('FastBTCAccessControl');
        const accessControl = await hre.ethers.getContractAt(
            'FastBTCAccessControl',
            accessControlDeployment.address
        );
        const adminRole = await accessControl.ROLE_ADMIN();

        if (hre.network.name === 'hardhat') {
            console.log("Setting Withdrawer as an admin.")
            await accessControl.grantRole(adminRole, result.address);
        } else {
            console.log("\n\n!!! NOTE !!!");
            console.log(`Withdrawer contract is deployed to ${result.address}, set the access control manually!`)
            const txData = accessControl.interface.encodeFunctionData('grantRole', [
                adminRole,
                result.address
            ]);
            console.log("To set the permissions, send a transaction with data")
            console.log(txData)
            console.log(`To the FastBTCAccessControl contract at ${accessControl.address}`);
            console.log("\n\n")
        }
    }
};
export default func;
