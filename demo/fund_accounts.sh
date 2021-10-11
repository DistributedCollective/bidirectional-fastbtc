#!/bin/bash
set -e
cd "$(dirname "$0")"
THIS_DIR=$(pwd)

USER_ADDRESS=$(jq -r '.rsk.user.address' test_accounts.json)
USER_PRIVATE_KEY=$(jq -r '.rsk.user.privateKey' test_accounts.json)
NODE1_ADDRESS=$(jq -r '.rsk.node1.address' test_accounts.json)
NODE2_ADDRESS=$(jq -r '.rsk.node2.address' test_accounts.json)
NODE3_ADDRESS=$(jq -r '.rsk.node3.address' test_accounts.json)

echo "Your user account is $USER_ADDRESS"
echo "Private key (add to Metamask): $USER_PRIVATE_KEY"

cd ../packages/fastbtc-contracts

echo "Funding accounts"
npx hardhat --network localhost free-money $USER_ADDRESS 10.0
npx hardhat --network localhost free-money $NODE1_ADDRESS 10.0
npx hardhat --network localhost free-money $NODE2_ADDRESS 10.0
npx hardhat --network localhost free-money $NODE3_ADDRESS 10.0
echo "Accounts funded"
