import "@nomiclabs/hardhat-waffle";
import "hardhat-deploy";
import "@tenderly/hardhat-tenderly";
import dotenv from "dotenv";
import * as fs from 'fs';
import {task, types} from "hardhat/config";
import {BigNumber, Signer} from 'ethers';
import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {formatUnits, parseUnits} from 'ethers/lib/utils';
import * as utils from "./utils";

dotenv.config();

const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || '';

const INTEGRATION_TEST_ADDRESSES: Record<string, string> = {
    'FastBTCAccessControl': '0xe7f1725e7734ce288f8367e1bb143e90bb3f0512',
    'BTCAddressValidator': '0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0',
    'FastBTCBridge': '0xcf7ed3acca5a467e9e704c703e8d87f634fb0fc9',
}
async function getDeploymentAddress(givenAddress: string|undefined, hre: HardhatRuntimeEnvironment, name: string): Promise<string> {
    if (givenAddress) {
        return givenAddress;
    }
    let address: string|undefined = undefined;
    if (hre.network.name === 'integration-test') {
        address = INTEGRATION_TEST_ADDRESSES[name];
    }
    if (address) {
        return address;
    }
    const deployment = await hre.deployments.get(name);
    return deployment.address;
}

task("accounts", "Prints the list of accounts", async (args, hre) => {
    const accounts = await hre.ethers.getSigners();

    for (const account of accounts) {
        const balance = await hre.ethers.provider.getBalance(account.address);
        console.log(account.address, "balance:", hre.ethers.utils.formatEther(balance));
    }
});

task("federators", "Prints the list of federators", async (args, hre) => {
    const accessControl = await hre.ethers.getContractAt(
        'FastBTCAccessControl',
        await getDeploymentAddress(undefined, hre, 'FastBTCAccessControl'),
    );
    const federators = await accessControl.federators();

    for (const federator of federators) {
        console.log(federator);
    }
});

task("show-transfer", "Show transfer details")
    .addPositionalParam('btcAddressOrTransferId')
    .addOptionalPositionalParam('nonce')
    .addOptionalParam("bridgeAddress", "FastBTCBridge contract address (if empty, use deployment)")
    .setAction(async ({ btcAddressOrTransferId, nonce, bridgeAddress }, hre) => {
        const contract = await hre.ethers.getContractAt(
            'FastBTCBridge',
            await getDeploymentAddress(bridgeAddress, hre, 'FastBTCBridge'),
        );

        let transferId;
        if (nonce === undefined) {
            console.log('Nonce not given, treat', btcAddressOrTransferId, 'as transferId');
            transferId = btcAddressOrTransferId;
        } else {
            console.log('Nonce given, treat', btcAddressOrTransferId, 'as btcAddress');
            transferId = await contract.getTransferId(btcAddressOrTransferId, nonce);
        }

        console.log('transferId', transferId);

        const transfer = await contract.getTransferByTransferId(transferId);
        for (let [key, value] of transfer.entries()) {
            console.log(
                key,
                BigNumber.isBigNumber(value) ? value.toString() : value
            );
        }
        console.log(transfer);

    });

task("free-money", "Sends free money to address")
    .addPositionalParam("address", "Address to send free money to")
    .addPositionalParam("rbtcAmount", "RBTC amount to send", "1.0")
    .setAction(async ({ address, rbtcAmount }, hre) => {
        if(!address) {
            throw new Error("Provide address as first argument");
        }
        const rbtcAmountWei = hre.ethers.utils.parseEther(rbtcAmount);
        console.log(`Sending ${rbtcAmount} rBTC (${rbtcAmountWei} wei) to ${address}`)

        const accounts = await hre.ethers.getSigners();

        const tx = await accounts[0].sendTransaction({
            to: address,
            value: rbtcAmountWei,
        })

        console.log('tx hash:', tx.hash, 'waiting for tx...');
        await tx.wait();
    });

task("transfer-rbtc-to-btc", "Transfers RBTC to BTC")
    .addPositionalParam("privateKey", "Private key of address to send free money from")
    .addPositionalParam("btcAddress", "BTC address to send")
    .addPositionalParam("rbtcAmount", "RBTC amount to send", "1.0")
    .addOptionalParam("bridgeAddress", "FastBTCBridge contract address (if empty, use deployment)")
    .addOptionalParam("repeat", "Repeat the transaction n times", "1")
    .setAction(async ({ privateKey, btcAddress, rbtcAmount, bridgeAddress, repeat}, hre) => {
        if(!privateKey || !btcAddress) {
            throw new Error("Provide address as first argument");
        }

        repeat = +repeat;
        if (repeat < 1) {
            throw new Error("Too low repeat count given");
        }

        const provider = hre.ethers.provider;
        const wallet = new hre.ethers.Wallet(privateKey, provider);
        const rbtcAmountWei = hre.ethers.utils.parseEther(rbtcAmount);
        console.log(`Sending ${rbtcAmount} rBTC from ${wallet.address} to BTC address ${btcAddress} ${repeat} times`)

        const fastBtcBridge = await hre.ethers.getContractAt(
            'FastBTCBridge',
            await getDeploymentAddress(bridgeAddress, hre, 'FastBTCBridge'),
            wallet,
        );
        console.log('Bridge address', fastBtcBridge.address);


        for (let i = 0; i < repeat; i++) {
            const receipt = await fastBtcBridge.transferToBtc(
                btcAddress,
                {value: rbtcAmountWei}
            );
            console.log('tx hash:', receipt.hash);
            // NOTE: don't wait here, we want to possibly get these to the same block
        }
    });

task("reclaim-transfer", "Reclaim a transfer")
    .addPositionalParam("privateKey", "Private key of address to send free money from")
    .addPositionalParam('btcAddressOrTransferId')
    .addOptionalPositionalParam('nonce')
    .addOptionalParam("bridgeAddress", "FastBTCBridge contract address (if empty, use deployment)")
    .setAction(async ({ privateKey, btcAddressOrTransferId, nonce, bridgeAddress }, hre) => {
        const provider = hre.ethers.provider;
        const wallet = new hre.ethers.Wallet(privateKey, provider);

        let contract = await hre.ethers.getContractAt(
            'FastBTCBridge',
            await getDeploymentAddress(bridgeAddress, hre, 'FastBTCBridge'),
        );
        contract = contract.connect(wallet);

        let transferId;
        if (nonce === undefined) {
            console.log('Nonce not given, treat', btcAddressOrTransferId, 'as transferId');
            transferId = btcAddressOrTransferId;
        } else {
            console.log('Nonce given, treat', btcAddressOrTransferId, 'as btcAddress');
            transferId = await contract.getTransferId(btcAddressOrTransferId, nonce);
        }

        const tx = await contract.reclaimTransfer(transferId);
        console.log('tx hash:', tx.hash, 'waiting...');
        await tx.wait()
    });

task("get-next-nonce", "Get the next nonce for a BTC address")
    .addPositionalParam('btcAddress')
    .addOptionalParam("bridgeAddress", "FastBTCBridge contract address (if empty, use deployment)")
    .setAction(async ({ btcAddress, bridgeAddress }, hre) => {
        const contract = await hre.ethers.getContractAt(
            'FastBTCBridge',
            await getDeploymentAddress(bridgeAddress, hre, 'FastBTCBridge'),
        );

        const nonce = await contract.getNextNonce(btcAddress);
        console.log(nonce);
    });

task("add-federator", "Add federator")
    .addVariadicPositionalParam("address", "RSK address to add")
    .addOptionalParam("privateKey", "Admin private key (else deployer is used)")
    .setAction(async ({ address: addresses, privateKey }, hre) => {
        if (addresses.length === 0) {
            throw new Error("At least 1 address must be given");
        }

        const signer = await getSignerFromPrivateKeyOrDeployer(privateKey, hre);

        console.log(`Adding ${addresses.length} federators`);

        const accessControl = await hre.ethers.getContractAt(
            'FastBTCAccessControl',
            await getDeploymentAddress(undefined, hre, 'FastBTCAccessControl'),
            signer,
        );

        for (const address of addresses) {
            console.log(`Making ${address} a federator`);
            const receipt = await accessControl.addFederator(
                address
            );
            console.log('tx hash:', receipt.hash);
        }

        console.log('all done');
    });


task("remove-federator", "Remove federator")
    .addVariadicPositionalParam("address", "RSK address to add")
    .addOptionalParam("privateKey", "Admin private key (else deployer is used)")
    .setAction(async ({ address: addresses, privateKey }, hre) => {
        if (addresses.length === 0) {
            throw new Error("At least 1 address must be given");
        }

        const signer = await getSignerFromPrivateKeyOrDeployer(privateKey, hre);

        console.log(`Removing ${addresses.length} federators`);
        const accessControl = await hre.ethers.getContractAt(
            'FastBTCAccessControl',
            await getDeploymentAddress(undefined, hre, 'FastBTCAccessControl'),
            signer,
        );

        for (const address of addresses) {
            console.log(`Removing ${address} from federators`);
            const receipt = await accessControl.removeFederator(
                address
            );
            console.log('tx hash:', receipt.hash);
        }

        console.log('all done');
    });


task('roles', 'Manage roles')
    .addPositionalParam('action', 'add/remove/check')
    .addOptionalParam('account', 'Account to manage the role of')
    .addParam('role', 'name of role')
    .addFlag('force', 'Force removal of admin role from myself, if needed')
    .addOptionalParam("privateKey", "Admin private key (else deployer is used)")
    .addOptionalParam("accessControl", "Access control address")
    .setAction(async (args, hre) => {
        const {
            action,
            account,
            privateKey,
            force,
        } = args;
        if (['add', 'remove', 'check'].indexOf(action) === -1) {
            throw new Error(`invalid action: ${action}`)
        }
        if (action !== 'check' && !account) {
            throw new Error('Account must be provided if action is not check');
        }
        const role = args.role.toUpperCase();
        if (['ADMIN', 'FEDERATOR', 'PAUSER', 'GUARD'].indexOf(role) === -1) {
            throw new Error(`invalid role: ${role}`);
        }

        const signer = await getSignerFromPrivateKeyOrDeployer(privateKey, hre);
        const signerAddress = await signer.getAddress();
        const accessControl = await hre.ethers.getContractAt(
            'FastBTCAccessControl',
            await getDeploymentAddress(args.accessControl, hre, 'FastBTCAccessControl'),
            signer,
        );

        console.log(`${action} role ${role}`, account ? `for ${account}` : '');
        const roleHash = await accessControl[`ROLE_${role}`]();
        console.log('role hash:', roleHash);
        const numRoleMembers = await accessControl.getRoleMemberCount(roleHash);
        console.log(`Members with the role (${numRoleMembers} in total):`);
        for (let i = 0; i < numRoleMembers; i++) {
            console.log('- ', await accessControl.getRoleMember(roleHash, i));
        }

        if (!account) {
            return;
        }

        if (action === 'remove' && role === 'ADMIN') {
            if (numRoleMembers <= 1) {
                throw new Error('Refusing to remove the only admin!')
            }
            if (account.toLowerCase() === signerAddress.toLowerCase()) {
                if (!force) {
                    throw new Error('refusing to remove the admin role from myself without --force!');
                } else {
                    console.warn('WARNING: going to remove the admin role from myself! Think about it for a while!');
                    await sleep(2000);
                }
            }
        }

        const hasRole = await accessControl.hasRole(roleHash, account);
        console.log(account, 'has role:', hasRole)

        let tx;
        if (action === 'add') {
            if (hasRole) {
                console.log('account already has the role, not adding');
                return;
            }
            console.log('adding role in 5s...');
            await sleep(5000);
            tx = await accessControl.grantRole(roleHash, account);
        } else if (action === 'remove') {
            if (!hasRole) {
                console.log('account does not have the role, not removing');
                return;
            }
            console.log('removing role in 5s...');
            await sleep(5000);
            tx = await accessControl.revokeRole(roleHash, account);
        } else {
            return;
        }
        console.log('tx hash:', tx.hash);
        console.log('waiting for tx...')
        await tx.wait();
        console.log('all done');
    });


task("set-limits", "Set min/max transfer limits")
    .addOptionalParam("minBtc", "Min in BTC (will be converted to satoshi)")
    .addOptionalParam("maxBtc", "Max in BTC (will be converted to satoshi)")
    .addOptionalParam("privateKey", "Admin private key (else deployer is used)")
    .addOptionalParam("bridgeAddress", "FastBTCBridge contract address (if empty, use deployment)")
    .setAction(async ({ privateKey, minBtc, maxBtc, bridgeAddress }, hre) => {
        const signer = await getSignerFromPrivateKeyOrDeployer(privateKey, hre);

        const contract = await hre.ethers.getContractAt(
            'FastBTCBridge',
            await getDeploymentAddress(bridgeAddress, hre, 'FastBTCBridge'),
            signer,
        );

        const currentMin = await contract.minTransferSatoshi();
        console.log('Current min: %s BTC (%s sat)', formatUnits(currentMin, 8), currentMin.toString());
        const currentMax = await contract.maxTransferSatoshi();
        console.log('Current max: %s BTC (%s sat)', formatUnits(currentMax, 8), currentMax.toString());

        if (minBtc) {
            const newMinSatoshi = parseUnits(minBtc, 8);
            if (currentMin === newMinSatoshi) {
                console.log("Min amount unchanged");
            } else {
                console.log('Setting minimum to: %s BTC (%s sat)', minBtc, newMinSatoshi.toString());
                const tx = await contract.setMinTransferSatoshi(newMinSatoshi);
                console.log('tx hash:', tx.hash, 'waiting for tx...');
                await tx.wait();
            }
        }

        if (maxBtc) {
            const newMaxSatoshi = parseUnits(maxBtc, 8);
            if (currentMax === newMaxSatoshi) {
                console.log("Max amount unchanged");
            } else {
                console.log('Setting maximum to: %s BTC (%s sat)', maxBtc, newMaxSatoshi.toString());
                const tx = await contract.setMaxTransferSatoshi(newMaxSatoshi);
                console.log('tx hash:', tx.hash, 'waiting for tx...');
                await tx.wait();
            }
        }
    });


task("fees", "View and manage fees")
    .addFlag('add', 'Add a new fee structure')
    .addOptionalParam('dynamicFeePercentage', 'Dynamic fee for the new fee structure, in percentage (max 2 decimals)', undefined, types.float)
    .addOptionalParam('baseFeeSatoshi', 'Base fee for the new fee structure, in satoshi', undefined, types.int)
    .addOptionalParam('setIndex', 'Change the current fee structure index', undefined, types.int)
    .addOptionalParam("privateKey", "Admin private key (else deployer is used)")
    .setAction(async ({ add, dynamicFeePercentage, baseFeeSatoshi, setIndex, privateKey }, hre) => {
        if (add && setIndex !== undefined) {
            console.error('Error: --add and --set-index cannot both be provided')
            return;
        }

        const signer = await getSignerFromPrivateKeyOrDeployer(privateKey, hre);

        const contract = await hre.ethers.getContractAt(
            'FastBTCBridge',
            await getDeploymentAddress(undefined, hre, 'FastBTCBridge'),
            signer,
        );

        const currentFeeStructureIndex = await contract.currentFeeStructureIndex();
        const currentDynamicFee = await contract.dynamicFee();
        const currentBaseFeeSatoshi = await contract.baseFeeSatoshi();
        console.log('Current dynamic fee:        ', currentDynamicFee / 100, '%', `(raw: ${currentDynamicFee})`);
        console.log(
            'Current base fee:           ',
            currentBaseFeeSatoshi, 'sat',
            `(${formatUnits(currentBaseFeeSatoshi, 8)} BTC)`,
        );
        console.log('Current fee structure index:', currentFeeStructureIndex);
        console.log('\nAvailable fee structures:')

        const logFeeStructure = (index: number, feeStructure: Record<string, number>) => {
            console.log(
                `Fee structure #${index}`,
                index === currentFeeStructureIndex ? '(current)' : ''
            )
            console.log(
                '    Dynamic fee:',
                feeStructure.dynamicFee / 100,'%',
                `(raw: ${feeStructure.dynamicFee})`);
            console.log(
                '    Base fee:   ',
                feeStructure.baseFeeSatoshi, 'sat',
                `(${formatUnits(feeStructure.baseFeeSatoshi, 8)} BTC)`,
            );
        }

        let lastIndex = 0;
        const feeStructures: Record<string, number>[] = [];
        for (let i = 0; i <= 255; i++) {
            const feeStructure = await contract.feeStructures(i);
            if (feeStructure.baseFeeSatoshi === 0 && feeStructure.dynamicFee === 0) {
                break;
            }
            logFeeStructure(i, feeStructure);

            feeStructures.push(feeStructure)

            lastIndex = i;
        }

        if (setIndex !== undefined) {
            if (setIndex > lastIndex) {
                console.error(`Index ${setIndex} out of bounds, must be between 0 and ${lastIndex}`);
                return;
            }
            if (setIndex === currentFeeStructureIndex) {
                console.error(`Fee structure #${setIndex} is already in use`);
                return;
            }

            const feeStructure = feeStructures[setIndex];
            console.log('Setting fee structure to:');
            logFeeStructure(setIndex, feeStructure);
            console.log('after 5s');
            await sleep(5000);
            const receipt = await contract.setCurrentFeeStructure(setIndex);
            console.log('tx hash:', receipt.hash);
            console.log('waiting for confirmation');
            await receipt.wait();
            console.log('Done.');
        } else if (add) {
            const index = lastIndex + 1;
            baseFeeSatoshi = baseFeeSatoshi ?? 0;
            dynamicFeePercentage = dynamicFeePercentage ?? 0.0;
            if (!baseFeeSatoshi && !dynamicFeePercentage) {
                console.error('baseFeeSatoshi and dynamicFeePercentage cannot both be 0');
                return;
            }
            if (dynamicFeePercentage > 0.2) {
                console.error("Too high dynamic fee -- you probably didn't mean it :)");
                return;
            }
            const dynamicFee = Math.floor(dynamicFeePercentage * 100);
            if (dynamicFee !== dynamicFeePercentage * 100) {
                console.error(`Dynamic fee ${dynamicFeePercentage} is too precise -- should have at most 2 decimals`);
                return;
            }
            const existingIndex = feeStructures.findIndex(f => (
                f.baseFeeSatoshi === baseFeeSatoshi && f.dynamicFee === dynamicFee
            ));
            if (existingIndex !== -1) {
                console.error('Fee structure already exists:')
                logFeeStructure(existingIndex, feeStructures[existingIndex]);
                console.error('not adding a duplicate one')
                return;
            }

            console.log('Adding fee structure')
            logFeeStructure(index, {
                baseFeeSatoshi,
                dynamicFee,
            });
            console.log('And setting it as current in 5s');
            await sleep(5000);

            let receipt = await contract.addFeeStructure(index, baseFeeSatoshi, dynamicFee);
            console.log('tx hash:', receipt.hash);
            console.log('waiting for confirmation');
            await receipt.wait();
            console.log('setting as current');
            receipt = await contract.setCurrentFeeStructure(index);
            console.log('tx hash:', receipt.hash);
            console.log('waiting for confirmation');
            await receipt.wait();
            console.log('Done.');
        }
    });

task("set-required-blocks-before-reclaim", "Self-explanatory")
    .addOptionalPositionalParam(
        'numBlocks',
        'If unset, just show current. If 0, allow reclaiming immediately',
        undefined,
        types.int
    )
    .addOptionalParam("bridgeAddress", "FastBTCBridge contract address (if empty, use deployment)")
    .setAction(async ({ numBlocks, bridgeAddress }, hre) => {
        const contract = await hre.ethers.getContractAt(
            'FastBTCBridge',
            await getDeploymentAddress(bridgeAddress, hre, 'FastBTCBridge'),
        );

        const currentValue = await contract.requiredBlocksBeforeReclaim(); // returns number since it's uint32
        console.log('Current required blocks before reclaim', currentValue);

        if (typeof numBlocks !== 'undefined') {
            if (currentValue === numBlocks) {
                console.log('Value not changed.');
                return;
            }
            console.log('Setting to', numBlocks);
            const tx = await contract.setRequiredBlocksBeforeReclaim(numBlocks);
            console.log('tx hash:', tx.hash, 'waiting...');
            await tx.wait();
        }
    });

task("pause-freeze", "Pause/unpause/freeze/unfreeze the bridge")
    .addPositionalParam('action', 'pause/unpause/freeze/unfreeze')
    .addOptionalParam("bridgeAddress", "FastBTCBridge contract address (if empty, use deployment)")
    .addOptionalParam("privateKey", "Admin private key (else deployer is used)")
    .setAction(async ({ action, bridgeAddress, privateKey }, hre) => {
        const signer = await getSignerFromPrivateKeyOrDeployer(privateKey, hre);
        const contract = await hre.ethers.getContractAt(
            'FastBTCBridge',
            await getDeploymentAddress(bridgeAddress, hre, 'FastBTCBridge'),
            signer,
        );

        const paused = await contract.paused();
        console.log('Paused:', paused);
        const frozen = await contract.frozen();
        console.log('Frozen:', frozen);

        let tx;
        switch(action) {
            case 'check':
                return;
            case 'pause':
                console.log('Pausing...');
                tx = await contract.pause();
                break;
            case 'unpause':
                console.log('Unpausing...');
                tx = await contract.unpause();
                break;
            case 'freeze':
                console.log('Freezing...');
                tx = await contract.freeze();
                break;
            case 'unfreeze':
                console.log('Unfreezing...');
                tx = await contract.unfreeze();
                break;
            default:
                console.error('Unknown action', action);
                return;
        }
        console.log('tx hash:', tx.hash, 'waiting...');
        await tx.wait();
        console.log('Done.');
        if (action === 'unfreeze') {
            console.log('Note that you still need to unpause');
        }

    });

// For testing
task('set-mining-interval', "Set mining interval")
    .addPositionalParam('ms', 'Mining interval as milliseconds (0 for automine)', undefined, types.int)
    .setAction(async ({ ms }, hre) => {
        if (ms === 0) {
            console.log("Enabling automining");
            await hre.network.provider.send('evm_setIntervalMining', [0]);
            await hre.network.provider.send('evm_setAutomine', [true]);
        } else {
            console.log("Disabling automining and enabling interval mining with", ms, "ms");
            await hre.network.provider.send('evm_setAutomine', [false]);
            await hre.network.provider.send('evm_setIntervalMining', [ms]);
        }
    });


// For testing
task("get-rbtc-balance", "Show formatted rBTC balance of address")
    .addPositionalParam('address')
    .addOptionalPositionalParam('blockTag')
    .setAction(async ({ address, blockTag }, hre) => {
        const { ethers: { provider, utils } } = hre;
        const balance = await provider.getBalance(address, blockTag);
        console.log(utils.formatEther(balance));
    });



task("initialize-fastbtc-v2",
    "Copy nonces and other stuff from the old bridge, initialize the new one")
    .addParam("startBlock", "Start block to scan for nonces", undefined, types.int)
    .addParam("oldBridgeAddress", "Old FastBTCBridge contract address (if empty, use deployment)")
    .addOptionalParam("newBridgeAddress", "FastBTCBridge contract address (if empty, use deployment)")
    .addOptionalParam("privateKey", "Admin private key (else deployer is used)")
    .addFlag('markReady', 'Finish initialization by calling markReady on the new bridge contract')
    .setAction(async ({ newBridgeAddress, oldBridgeAddress, startBlock, privateKey, markReady }, hre) => {
        const signer = await getSignerFromPrivateKeyOrDeployer(privateKey, hre);
        const oldFastbtcBridge = await hre.ethers.getContractAt(
            'FastBTCBridge',
            oldBridgeAddress,
            signer
        );

        const newFastbtcBridge = await hre.ethers.getContractAt(
            'FastBTCBridge',
            await getDeploymentAddress(newBridgeAddress, hre, 'FastBTCBridge'),
            signer
        );

        const oldAccessControl = await hre.ethers.getContractAt(
            'FastBTCAccessControl',
            await oldFastbtcBridge.accessControl(),
            signer
        );

        const newAccessControl = await hre.ethers.getContractAt(
            'FastBTCAccessControl',
            await newFastbtcBridge.accessControl(),
            signer
        );

        if (oldFastbtcBridge.address === newFastbtcBridge.address) {
            console.error('Old and new bridge addresses are the same');
            return;
        }

        if (await newFastbtcBridge.initialized()) {
            console.error('New bridge already initialized');
            return;
        }

        async function getCopyNoncesCalls(): Promise<any[]> {
            // NONCES
            // ======
            // - read NewBitcoinTransfer events from the old bridge from startBlock in batches of 10000
            const endBlock = await hre.ethers.provider.getBlockNumber();
            const bitcoinTransfers = await utils.getEvents(
                oldFastbtcBridge,
                oldFastbtcBridge.filters.NewBitcoinTransfer(),
                startBlock,
                endBlock,
                {
                    batchSize: 10000,
                }
            )

            // - get a list of unique bitcoin addresses from the events
            const allBitcoinAddresses: string[] = [];
            for (const event of bitcoinTransfers) {
                const bitcoinAddress = event.args!.btcAddress;
                if (!allBitcoinAddresses.includes(bitcoinAddress)) {
                    allBitcoinAddresses.push(bitcoinAddress);
                }
            }
            console.log('%d unique Bitcoin addresses', allBitcoinAddresses.length);

            // - for each address, get the nonce from the old bridge and the nonce from the new bridge (using getNextNonce)
            // - print the old nonce and new nonce for each address
            // - if the old nonce differs from the new nonce, add the bitcoin address to a list of bitcoin addresses to set
            const bitcoinAddressesToCopyNoncesFor: string[] = [];
            for (const bitcoinAddress of allBitcoinAddresses) {
                const oldNonce = await oldFastbtcBridge.getNextNonce(bitcoinAddress);
                const newNonce = await newFastbtcBridge.getNextNonce(bitcoinAddress);
                console.log(
                    utils.rightPad(bitcoinAddress, 62),
                    'old:', oldNonce,
                    'new:', newNonce,
                    'copy?', oldNonce !== newNonce,
                );
                if (oldNonce !== newNonce) {
                    bitcoinAddressesToCopyNoncesFor.push(bitcoinAddress);
                }
            }
            console.log('%d Bitcoin addresses to copy nonces for', bitcoinAddressesToCopyNoncesFor.length);

            const copyNoncesCalls: any[] = [];
            // split bitcoinAddressesToCopyNoncesFor into chunks
            const copyNoncesBatchSize = 200;
            for (let i = 0; i < bitcoinAddressesToCopyNoncesFor.length; i += copyNoncesBatchSize) {
                const btcAddresses = bitcoinAddressesToCopyNoncesFor.slice(i, i + copyNoncesBatchSize)
                copyNoncesCalls.push([oldFastbtcBridge.address, btcAddresses]);
            }
            if (copyNoncesCalls.length === 0) {
                console.log('No need to call copyNonces');
            } else {
                console.log('Calling copyNonces %d times:', copyNoncesCalls.length);
                for (const args of copyNoncesCalls) {
                    console.log('copyNonces(%s, %s);', ...args);
                }
            }
            return copyNoncesCalls;
        }

        async function getFeeStructureArgs(): Promise<undefined|[number,number,number][]> {
            // FEE STRUCTURE
            // =============
            // - get the fee structure from the old bridge
            const oldBridgeFeeStructureMaxIndex = await oldFastbtcBridge.currentFeeStructureIndex();
            const ret: [number, number, number][] = [];
            for (let i = 1; i <= oldBridgeFeeStructureMaxIndex; i++) {
                const oldBridgeFeeStructure = await oldFastbtcBridge.feeStructures(i);
                //const newBridgeFeeStructureIndex = await newFastbtcBridge.currentFeeStructureIndex();
                const newBridgeFeeStructure = await newFastbtcBridge.feeStructures(i);
                console.log('Fee structure %s on old bridge: %s', i, oldBridgeFeeStructure);
                console.log('Fee structure %s on new bridge: %s', i, newBridgeFeeStructure);

                // - if the fee structure on the old bridge is the same as the fee structure on the new bridge, we're done
                if (
                    oldBridgeFeeStructure.baseFeeSatoshi === newBridgeFeeStructure.baseFeeSatoshi &&
                    oldBridgeFeeStructure.dynamicFee === newBridgeFeeStructure.dynamicFee
                ) {
                    console.log('Fee structure is the same, no need to call setFeeStructure');
                } else {
                    ret.push([
                        //newBridgeFeeStructureIndex + 1,
                        i,
                        oldBridgeFeeStructure.baseFeeSatoshi,
                        oldBridgeFeeStructure.dynamicFee,
                    ])
                }
            }
            return ret;
        }

        const copyNoncesCalls = await getCopyNoncesCalls();
        //fs.writeFileSync('copynonces.json', JSON.stringify(copyNoncesCalls, null, 2));
        //const copyNoncesCalls = JSON.parse(fs.readFileSync('copynonces.json', 'utf-8'));

        const feeStructureArgs = await getFeeStructureArgs();

        const oldMinTransferSatoshi = await oldFastbtcBridge.minTransferSatoshi();
        const newMinTransferSatoshi = await newFastbtcBridge.minTransferSatoshi();
        console.log("minTransferSatoshi: old %s, new %s", oldMinTransferSatoshi, newMinTransferSatoshi);

        const oldMaxTransferSatoshi = await oldFastbtcBridge.maxTransferSatoshi();
        const newMaxTransferSatoshi = await newFastbtcBridge.maxTransferSatoshi();
        console.log("maxTransferSatoshi: old %s, new %s", oldMaxTransferSatoshi, newMaxTransferSatoshi);

        const roleNames = [
            'ADMIN',
            'FEDERATOR',
            'PAUSER',
            'GUARD',
            //'CONFIG_ADMIN' // doesn't exist in the old one
        ];
        const addedRoleMembers: {[roleName: string]: string[]} = {};
        for (const roleName of roleNames) {
            const role = await oldAccessControl['ROLE_' + roleName]();
            const oldCount = await oldAccessControl.getRoleMemberCount(role);
            const newCount = await newAccessControl.getRoleMemberCount(role);
            console.log('Role %s: %s. Old: %s, new %s', roleName, role, oldCount, newCount);
            for (let i = 0; i < oldCount; i++) {
                const address = await oldAccessControl.getRoleMember(role, i);
                const isMemberOnNewBridge = await newAccessControl.hasRole(role, address);
                console.log(' - %s, is already added: %s', address, isMemberOnNewBridge ? 'yes' : 'no');
                if (!isMemberOnNewBridge) {
                    if (!addedRoleMembers[roleName]) {
                        addedRoleMembers[roleName] = [];
                    }
                    addedRoleMembers[roleName].push(address);
                }
            }
        }
        console.log('Role members to add:', addedRoleMembers);

        const response = await utils.readInput(
            'Continue initialization (will not mark the contract ready yet)? (y/N) ');
        if (response !== 'y') {
            console.log('Aborting');
            return;
        }

        if (feeStructureArgs && feeStructureArgs.length) {
            for (const args of feeStructureArgs) {
                console.log('addFeeStructure(%s, %s, %s);', ...args);
                let tx = await newFastbtcBridge.addFeeStructure(...args);
                console.log('addFeeStructure tx:', tx.hash);
                await tx.wait();
            }
            const lastIndex = feeStructureArgs[feeStructureArgs.length -1][0];
            console.log('setCurrentFeeStructure(%s);', lastIndex);
            let tx = await newFastbtcBridge.setCurrentFeeStructure(lastIndex);
            console.log('setCurrentFeeStructure tx:', tx.hash);
            await tx.wait();
        }

        if (oldMinTransferSatoshi !== newMinTransferSatoshi) {
            console.log('setMinTransferSatoshi(%s);', oldMinTransferSatoshi);
            const tx = await newFastbtcBridge.setMinTransferSatoshi(oldMinTransferSatoshi);
            console.log('setMinTransferSatoshi tx:', tx.hash);
            await tx.wait();
        }

        if (oldMaxTransferSatoshi !== newMaxTransferSatoshi) {
            console.log('setMaxTransferSatoshi(%s);', oldMaxTransferSatoshi);
            const tx = await newFastbtcBridge.setMaxTransferSatoshi(oldMaxTransferSatoshi);
            console.log('setMaxTransferSatoshi tx:', tx.hash);
            await tx.wait();
        }

        for (const [roleName, members] of Object.entries(addedRoleMembers)) {
            const role = await newAccessControl['ROLE_' + roleName]();
            console.log('Granting role %s (%s) to members: %s', roleName, role, members);
            for (const member of members) {
                console.log('grantRole(%s, %s);', role, member);
                const tx = await newAccessControl.grantRole(role, member);
                console.log('grantRole tx:', tx.hash);
                await tx.wait();
            }
        }

        for (const args of copyNoncesCalls) {
            console.log('copyNonces(%s, %s);', ...args);
            const tx = await newFastbtcBridge.copyNonces(...args);
            console.log('copyNonces tx:', tx.hash);
            await tx.wait();
        }

        if (markReady) {
            const answer = await utils.readInput(
                'Mark new bridge as ready? THIS IS IRREVERSIBLE!! (y/N) ');
            if (answer === 'y') {
                console.log('Marking new bridge as ready...');
                const tx = await newFastbtcBridge.markReady();
                console.log('markReady tx:', tx.hash);
                await tx.wait();
            }
        } else {
            console.log('Not marking the new bridge as ready because --mark-ready not given');
        }
    });


// For testing
task("wait-for-startup", "Wait for network startup")
    .addOptionalParam("maxWaitTime", "Maximum wait time in seconds")
    .setAction(async ({ maxWaitTime = 600 }, hre) => {
        console.log(`Waiting for connection to ${hre.network.name} (max ${maxWaitTime} seconds)`)
        const start = Date.now();
        const deadline = start + maxWaitTime * 1000;
        let lastError;
        while (true) {
            const timeLeftMs = deadline - Date.now();
            if (timeLeftMs < 0) {
                break;
            }

            try {
                await hre.network.provider.send('eth_chainId', []);
                console.log(`Connected to network ${hre.network.name}!`)
                return;
            } catch (e) {
                lastError = e;
                console.log(`Could not connect to network ${hre.network.name}, waiting... (${timeLeftMs/1000}s left)`);
                await sleep(5000);
            }
        }
        console.error(lastError);
        throw new Error("Could not connect to network");
    })

const btcAddressValidatorReadVars = [
    'bech32MinLength',
    'bech32MaxLength',
    'nonBech32MinLength',
    'nonBech32MaxLength',
    'bech32Prefix',
]
task("btc-address-validator", "Manage BTC address validator")
    .addOptionalParam("nonBech32Prefixes", "Set non-bech32 prefixes to these (comma delimited)")
    .addOptionalParam("privateKey", "Admin private key (else deployer is used)")
    .setAction(async ({ nonBech32Prefixes, privateKey }, hre) => {
        const signer = await getSignerFromPrivateKeyOrDeployer(privateKey, hre);

        const deployment = await hre.deployments.get('BTCAddressValidator');
        const contract = await hre.ethers.getContractAt(
           'BTCAddressValidator',
           deployment.address,
           signer,
        );

        console.log('Current settings:')
        for (const key of btcAddressValidatorReadVars) {
            console.log(`${key}:`, (await contract[key]()).toString());
        }
        for (let i = 0; i < 10; i++) {
            try {
                console.log(`nonBech32Prefixes[${i}]:`, await contract.nonBech32Prefixes(i));
            } catch (e) {
                // length exceeded, probably
                break;
            }
        }

        if (nonBech32Prefixes !== undefined) {
            const prefixes: string[] = nonBech32Prefixes.split(',').map((s: string) => s.trim()).filter((s: string) => s);
            console.log('setting non-bech32 prefixes to %s (after 5s)', prefixes);
            await sleep(5000)
            const receipt = await contract.setNonBech32Prefixes(prefixes);
            console.log('tx hash:', receipt.hash);
            if (receipt.wait) {
                console.log('waiting for tx to be mined')
                console.log(await receipt.wait());
                console.log('all done')
            }
        }
    });


task("withdraw-rbtc", "Withdraw rBTC from the FastBTCBridge")
    .addOptionalParam("amount", "Amount to withdraw in rbtc (default: interactive)")
    .addOptionalParam("bridgeAddress", "FastBTCBridge contract address (if empty, use deployment)")
    .addOptionalParam("privateKey", "Admin private key (else deployer is used)")
    .addFlag('showWithdrawable', 'Show total amount of rBTC that can be withdrawn by the admin')
    .setAction(async ({ amount, showWithdrawable, bridgeAddress, privateKey }, hre) => {
        const signer = await getSignerFromPrivateKeyOrDeployer(privateKey, hre);
        const contract = await hre.ethers.getContractAt(
            'FastBTCBridge',
            await getDeploymentAddress(bridgeAddress, hre, 'FastBTCBridge'),
            signer,
        );

        const contractBalanceWei = await hre.ethers.provider.getBalance(contract.address);
        const contractBalance = hre.ethers.utils.formatEther(contractBalanceWei);
        console.log('Contract balance: %s rBTC (%s wei)', contractBalance, contractBalanceWei.toString());

        if (showWithdrawable) {
            const withdrawableWei = await contract.totalAdminWithdrawableRbtc();
            const withdrawable = hre.ethers.utils.formatEther(withdrawableWei);
            console.log('Withdrawable: %s rBTC (%s wei)', withdrawable, withdrawableWei.toString());
        }

        const receiver = await signer.getAddress();
        console.log('Withdrawing to: %s', receiver);
        if (!amount) {
            amount = await utils.readInput('Amount to withdraw in rBTC: ');
        }

        const amountWei = hre.ethers.utils.parseEther(amount);
        console.log('Withdrawing %s rBTC (%s wei) to %s', amount, amountWei.toString(), receiver);
        const answer = await utils.readInput('Are you sure? (y/N) ');
        if (answer !== 'y') {
            console.log('Aborting');
            return;
        }

        console.log('Withdrawing in 5s...')
        await utils.sleep(5);
        const tx = await contract.withdrawRbtc(amountWei, receiver);
        console.log('tx hash:', tx.hash);
        await tx.wait();
        console.log('All done.');
    });


task("show-next-nonce", "Show the next nonce of BTC address")
    .addPositionalParam("btcAddress", "BTC address")
    .addOptionalParam("bridgeAddress", "FastBTCBridge contract address (if empty, use deployment)")
    .setAction(async ({ btcAddress, bridgeAddress }, hre) => {
        const contract = await hre.ethers.getContractAt(
            'FastBTCBridge',
            await getDeploymentAddress(bridgeAddress, hre, 'FastBTCBridge'),
        );

        const nonce = await contract.getNextNonce(btcAddress);
        console.log(nonce);
    });


async function getSignerFromPrivateKeyOrDeployer(
    privateKey: string | undefined,
    hre: HardhatRuntimeEnvironment
): Promise<Signer> {
    if(privateKey) {
        const provider = hre.ethers.provider;
        return new hre.ethers.Wallet(privateKey, provider);
    } else {
        const {deployer} = await hre.getNamedAccounts();
        return await hre.ethers.getSigner(deployer);
    }
}

async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    })
}

if (!DEPLOYER_PRIVATE_KEY) {
    console.warn('DEPLOYER_PRIVATE_KEY missing, non-local deployments not working');
}

const privateKeys = DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [];

export default {
    solidity: {
        compilers: [
            {
                version: "0.8.9",
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 10000,
                    }
                }
            },
        ]
    },
    networks: {
        hardhat: {},
        // NOTE: hardhat-tenderly wants the networks like this for verification to work (it's a bit silly)
        "rsk": {
            url: "https://mainnet.sovryn.app/rpc",
            network_id: 30,
            confirmations: 4,
            gasMultiplier: 1.25,
            accounts: privateKeys,
        },
        "rsk-testnet": {
            url: "https://testnet.sovryn.app/rpc",
            network_id: 31,
            accounts: privateKeys,
        },
        "integration-test": {
            url: "http://localhost:18545",
            network_id: 31337,
        },
    },
    namedAccounts: {
        deployer: {
            default: 0
        },
    },
};
