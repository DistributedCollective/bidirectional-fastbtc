import "@nomiclabs/hardhat-waffle";
import "hardhat-deploy";
import dotenv from "dotenv";
import {task} from "hardhat/config";

dotenv.config();

const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || '';

task("accounts", "Prints the list of accounts", async (args, hre) => {
    const accounts = await hre.ethers.getSigners();

    for (const account of accounts) {
        console.log(account.address);
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
