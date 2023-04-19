#!/bin/bash
set -e
cd "$(dirname "$0")"
THIS_DIR=$(pwd)
FASTBTC_BRIDGE=0xcf7ed3acca5a467e9e704c703e8d87f634fb0fc9
FASTBTC_IN=0x0000000000000000000000000000000000001337

cd ../../packages/fastbtc-contracts
echo "User BTC balance before:           $($THIS_DIR/bitcoin-cli.sh -rpcwallet=user getbalance) BTC"
echo "FastBTCBridge rBTC balance before: $(npx hardhat --network integration-test get-rbtc-balance $FASTBTC_BRIDGE) rBTC"
echo "FastBTC-in rBTC balance before:    $(npx hardhat --network integration-test get-rbtc-balance $FASTBTC_IN) rBTC"
NUM_TRANSFERS=4
npx hardhat --network integration-test free-money 0xB3b77A8Bc6b6fD93D591C0F34f202eC02e9af2e8 5
npx hardhat --network integration-test transfer-rbtc-to-btc 0xc1daad254b7005eca65780d47213d3de15bd92fcce83777487c5082c6d27600a bcrt1qq8zjw66qrgmynrq3gqdx79n7fcchtaudq4rrf0 0.5 --bridge-address 0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9 --repeat $NUM_TRANSFERS

echo "$NUM_TRANSFERS transfers sent. They should be visible in a couple of minutes, and replenishment of FastBTC-in ($FASTBTC_IN) should also take place."
echo "Polling balances, Ctrl-C to exit"
while true ; do
    echo "User BTC: $($THIS_DIR/bitcoin-cli.sh -rpcwallet=user getbalance)  FastBTCBridge rBTC: $(npx hardhat --network integration-test get-rbtc-balance $FASTBTC_BRIDGE)  FastBTC-in rBTC: $(npx hardhat --network integration-test get-rbtc-balance $FASTBTC_IN)"
    sleep 10
done
