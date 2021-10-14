#!/bin/bash
set -e
cd "$(dirname "$0")"
THIS_DIR=$(pwd)

which jq >/dev/null || (echo "command jq needs to be installed" && exit 1)
if test -f "$THIS_DIR/run/hardhat.pid" ; then
    echo "Killing existing Hardhat instance"
    kill $(cat $THIS_DIR/run/hardhat.pid) 2>/dev/null || true
fi

echo "Build contracts (may result in filesystem changes)"
cd ../packages/fastbtc-contracts
make

echo "Starting Hardhat chain"
npx hardhat node --hostname 0.0.0.0 >$THIS_DIR/logs/hardhat.log 2>$THIS_DIR/logs/hardhat-error.log &
HARDHAT_PID=$!
echo $HARDHAT_PID > $THIS_DIR/run/hardhat.pid
echo "Hardhat started pid $HARDHAT_PID, logs at $THIS_DIR/logs/hardhat.log, sleeping 5s"
sleep 5
echo "Setting up federators"
echo "Node 1"
npx hardhat --network localhost add-federator $(jq -r '.rsk.node1.address' "$THIS_DIR/test_accounts.json")
echo "Node 2"
npx hardhat --network localhost add-federator $(jq -r '.rsk.node2.address' "$THIS_DIR/test_accounts.json")
echo "Node 3"
npx hardhat --network localhost add-federator $(jq -r '.rsk.node3.address' "$THIS_DIR/test_accounts.json")
