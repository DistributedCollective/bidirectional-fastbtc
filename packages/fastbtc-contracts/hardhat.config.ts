import "@nomiclabs/hardhat-waffle";
import "hardhat-deploy";
import dotenv from "dotenv";
import {task} from "hardhat/config";
import {Signer, Wallet} from 'ethers';

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
    .setAction(async ({ privateKey, btcAddress, rbtcAmount }, hre) => {
        if(!privateKey || !btcAddress) {
            throw new Error("Provide address as first argument");
        }

        const provider = hre.ethers.provider;
        const wallet = new hre.ethers.Wallet(privateKey, provider);
        const rbtcAmountWei = hre.ethers.utils.parseEther(rbtcAmount);
        console.log(`Sending ${rbtcAmount} rBTC from ${wallet.address} to BTC address ${btcAddress}`)

        const deployment = await hre.deployments.get('FastBTCBridge');
        console.log('Bridge address', deployment.address);
        const fastBtcBridge = await hre.ethers.getContractAt(
            'FastBTCBridge',
            deployment.address,
            wallet,
        );
        const nonce = await fastBtcBridge.getNextNonce(btcAddress);
        console.log('Next BTC nonce', nonce, nonce.toString());
        const receipt = await fastBtcBridge.transferToBtc(
            btcAddress,
            nonce,
            {value: rbtcAmountWei}
        );
        console.log('tx hash:', receipt.hash);
    });


task("add-federator", "Add federator")
    .addPositionalParam("address", "RSK address to add")
    .addOptionalParam("privateKey", "Admin private key (else deployer is used)")
    .setAction(async ({ address, privateKey }, hre) => {
        if (!address) {
            throw new Error("Address must be given");
        }

        let signer: Signer;
        if(privateKey) {
            const provider = hre.ethers.provider;
            signer = new hre.ethers.Wallet(privateKey, provider);
        } else {
            const {deployer} = await hre.getNamedAccounts();
            signer = await hre.ethers.getSigner(deployer);
        }

        const deployment = await hre.deployments.get('FastBTCAccessControl');
        console.log('Bridge address', deployment.address);
        console.log(`Making ${address} a federator`);
        const accessControl = await hre.ethers.getContractAt(
            'FastBTCAccessControl',
            deployment.address,
            signer,
        );

        const receipt = await accessControl.addFederator(
            address
        );
        console.log('tx hash:', receipt.hash);
    });


task("remove-federator", "Remove federator")
    .addPositionalParam("address", "RSK address to add")
    .addOptionalParam("privateKey", "Admin private key (else deployer is used)")
    .setAction(async ({ address, privateKey }, hre) => {
        if (!address) {
            throw new Error("Address must be given");
        }

        let signer: Signer;
        if(privateKey) {
            const provider = hre.ethers.provider;
            signer = new hre.ethers.Wallet(privateKey, provider);
        } else {
            const {deployer} = await hre.getNamedAccounts();
            signer = await hre.ethers.getSigner(deployer);
        }

        const deployment = await hre.deployments.get('FastBTCAccessControl');
        console.log('Bridge address', deployment.address);
        console.log(`Removing ${address} from federators`);
        const accessControl = await hre.ethers.getContractAt(
            'FastBTCAccessControl',
            deployment.address,
            signer,
        );

        const receipt = await accessControl.removeFederator(
            address
        );
        console.log('tx hash:', receipt.hash);
    });

if (!DEPLOYER_PRIVATE_KEY) {
    console.warn('DEPLOYER_PRIVATE_KEY missing, non-local deployments not working');
}

const privateKeys = DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [];

export default {
    solidity: {
        compilers: [
            {
                version: "0.8.4",
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
    },
    namedAccounts: {
        deployer: {
            default: 0
        },
    },
};
