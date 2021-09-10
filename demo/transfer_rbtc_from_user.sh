#!/bin/bash
set -e
cd "$(dirname "$0")"
THIS_DIR=$(pwd)

USER_PRIVATE_KEY=$(jq -r '.user.privateKey' test_accounts.json)

cd ../packages/fastbtc-contracts
BTC_ADDRESS=1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2
npx hardhat --network localhost transfer-rbtc-to-btc $USER_PRIVATE_KEY $BTC_ADDRESS 1.23
