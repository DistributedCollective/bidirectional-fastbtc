#!/bin/bash
set -e
cd "$(dirname "$0")"
THIS_DIR=$(pwd)

USER_PRIVATE_KEY=$(jq -r '.rsk.user.privateKey' test_accounts.json)
USER_BTC_ADDRESS=$(jq -r '.bitcoin.user.address' test_accounts.json)

cd ../packages/fastbtc-contracts
#BTC_ADDRESS=1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2
#npx hardhat --network localhost transfer-rbtc-to-btc $USER_PRIVATE_KEY $BTC_ADDRESS 1.23
npx hardhat --network localhost transfer-rbtc-to-btc $USER_PRIVATE_KEY $USER_BTC_ADDRESS 0.15
