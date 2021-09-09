#!/bin/bash
set -e
cd "$(dirname "$0")"
THIS_DIR=$(pwd)

which jq >/dev/null || (echo "command jq needs to be installed" && exit 1)
if test -f "$THIS_DIR/run/hardhat.pid" ; then
    echo "Killing existing Hardhat instance"
    kill $(cat $THIS_DIR/run/hardhat.pid) 2>/dev/null || true
fi

cd ../packages/fastbtc-contracts
npx hardhat compile
npx hardhat node >$THIS_DIR/logs/hardhat.log 2>$THIS_DIR/logs/hardhat-error.log &
HARDHAT_PID=$!
echo $HARDHAT_PID > $THIS_DIR/run/hardhat.pid
echo "Hardhat started pid $HARDHAT_PID, logs at $THIS_DIR/logs/hardhat.log, sleeping 5s"
sleep 5
