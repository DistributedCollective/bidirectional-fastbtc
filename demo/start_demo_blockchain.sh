#!/bin/bash
set -e
cd "$(dirname "$0")"
THIS_DIR=$(pwd)

which jq >/dev/null || (echo "command jq needs to be installed" && exit 1)
if test -f "$THIS_DIR/run/hardhat.pid" ; then
    echo "Killing existing Hardhat instance"
    kill $(cat $THIS_DIR/run/hardhat.pid) 2>/dev/null || true
fi
USER_ADDRESS=$(jq -r '.user.address' test_accounts.json)
USER_PRIVATE_KEY=$(jq -r '.user.privateKey' test_accounts.json)
NODE1_ADDRESS=$(jq -r '.node1.address' test_accounts.json)
NODE2_ADDRESS=$(jq -r '.node2.address' test_accounts.json)
NODE3_ADDRESS=$(jq -r '.node3.address' test_accounts.json)

echo "Your user account is $USER_ADDRESS"
echo "Private key (add to Metamask): $USER_PRIVATE_KEY"

cd ../packages/fastbtc-contracts
npx hardhat compile
npx hardhat node >$THIS_DIR/logs/hardhat.log 2>$THIS_DIR/logs/hardhat-error.log &
HARDHAT_PID=$!
echo $HARDHAT_PID > $THIS_DIR/run/hardhat.pid
echo "Hardhat started pid $HARDHAT_PID, logs at $THIS_DIR/logs/hardhat.log, sleeping 5s"
sleep 5
echo "Funding accounts"
npx hardhat --network localhost free-money $USER_ADDRESS 10.0
npx hardhat --network localhost free-money $NODE1_ADDRESS 10.0
npx hardhat --network localhost free-money $NODE2_ADDRESS 10.0
npx hardhat --network localhost free-money $NODE3_ADDRESS 10.0
echo "Accounts funded"
