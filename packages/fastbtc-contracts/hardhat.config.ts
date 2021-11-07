import "@nomiclabs/hardhat-waffle";
import "hardhat-deploy";
import "@tenderly/hardhat-tenderly";
import dotenv from "dotenv";
import {task, types} from "hardhat/config";
import {BigNumber, Signer} from 'ethers';
import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {formatUnits, parseUnits} from 'ethers/lib/utils';

dotenv.config();

const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || '';

task("accounts", "Prints the list of accounts", async (args, hre) => {
    const accounts = await hre.ethers.getSigners();

    for (const account of accounts) {
        console.log(account.address);
    }
});

task("federators", "Prints the list of federators", async (args, hre) => {
    const deployment = await hre.deployments.get('FastBTCAccessControl');
    const accessControl = await hre.ethers.getContractAt(
        'FastBTCAccessControl',
        deployment.address,
    );
    const federators = await accessControl.federators();

    for (const federator of federators) {
        console.log(federator);
    }
});


task("show-transfer", "Show transfer details")
    .addPositionalParam('btcAddressOrTransferId')
    .addOptionalPositionalParam('nonce')
    .setAction(async ({ btcAddressOrTransferId, nonce }, hre) => {
        const deployment = await hre.deployments.get('FastBTCBridge');
        const contract = await hre.ethers.getContractAt(
            'FastBTCBridge',
            deployment.address,
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

        const receipt = await accounts[0].sendTransaction({
            to: address,
            value: rbtcAmountWei,
        })

        console.log('tx hash:', receipt.hash);
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

        const provider = hre.ethers.provider;
        const wallet = new hre.ethers.Wallet(privateKey, provider);
        const rbtcAmountWei = hre.ethers.utils.parseEther(rbtcAmount);
        console.log(`Sending ${rbtcAmount} rBTC from ${wallet.address} to BTC address ${btcAddress}`)

        if (!bridgeAddress) {
            const deployment = await hre.deployments.get('FastBTCBridge');
            bridgeAddress = deployment.address;
        }
        console.log('Bridge address', bridgeAddress);
        const fastBtcBridge = await hre.ethers.getContractAt(
            'FastBTCBridge',
            bridgeAddress,
            wallet,
        );

        repeat = +repeat;
        if (repeat < 1) {
            throw new Error("Too low repeat count given");
        }

        for (let i = 0; i < repeat; i++) {
            const receipt = await fastBtcBridge.transferToBtc(
                btcAddress,
                {value: rbtcAmountWei}
            );
            console.log('tx hash:', receipt.hash);
        }
    });


task("add-federator", "Add federator")
    .addVariadicPositionalParam("address", "RSK address to add")
    .addOptionalParam("privateKey", "Admin private key (else deployer is used)")
    .setAction(async ({ address: addresses, privateKey }, hre) => {
        if (addresses.length === 0) {
            throw new Error("At least 1 address must be given");
        }

        const signer = await getSignerFromPrivateKeyOrDeployer(privateKey, hre);

        const deployment = await hre.deployments.get('FastBTCAccessControl');
        console.log('Bridge address', deployment.address);
        console.log(`Adding ${addresses.length} federators`);

        const accessControl = await hre.ethers.getContractAt(
            'FastBTCAccessControl',
            deployment.address,
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

        const deployment = await hre.deployments.get('FastBTCAccessControl');
        console.log('Bridge address', deployment.address);

        console.log(`Removing ${addresses.length} federators`);
        const accessControl = await hre.ethers.getContractAt(
            'FastBTCAccessControl',
            deployment.address,
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


task("set-limits", "Set min/max transfer limits")
    .addOptionalParam("minBtc", "Min in BTC (will be converted to satoshi)")
    .addOptionalParam("maxBtc", "Max in BTC (will be converted to satoshi)")
    .addOptionalParam("privateKey", "Admin private key (else deployer is used)")
    .setAction(async ({ privateKey, minBtc, maxBtc }, hre) => {
        const signer = await getSignerFromPrivateKeyOrDeployer(privateKey, hre);

        const deployment = await hre.deployments.get('FastBTCBridge');
        const contract = await hre.ethers.getContractAt(
            'FastBTCBridge',
            deployment.address,
            signer,
        );

        const currentMin = await contract.minTransferSatoshi();
        console.log('Current min: %s BTC (%s sat)', formatUnits(currentMin, 8), currentMin.toString());
        const currentMax = await contract.maxTransferSatoshi();
        console.log('Current max: %s BTC (%s sat)', formatUnits(currentMax, 8), currentMax.toString());

        if (minBtc) {
            const newMinSatoshi = parseUnits(minBtc, 8);
            console.log('Setting minimum to: %s BTC (%s sat)', minBtc, newMinSatoshi.toString());
            const receipt = await contract.setMinTransferSatoshi(newMinSatoshi);
            console.log('tx hash:', receipt.hash);
        }

        if (maxBtc) {
            const newMaxSatoshi = parseUnits(maxBtc, 8);
            console.log('Setting maximum to: %s BTC (%s sat)', maxBtc, newMaxSatoshi.toString());
            const receipt = await contract.setMaxTransferSatoshi(newMaxSatoshi);
            console.log('tx hash:', receipt.hash);
        }
    });


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
                version: "0.8.4",
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 1000,
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
