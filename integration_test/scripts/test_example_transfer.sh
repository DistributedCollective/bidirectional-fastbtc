#!/bin/bash
set -e
cd "$(dirname "$0")"
THIS_DIR=$(pwd)
cd ../../packages/fastbtc-contracts
echo "User balance before:        $($THIS_DIR/bitcoin-cli.sh -rpcwallet=user getbalance) BTC"
echo "Multisig balance before:    $($THIS_DIR/bitcoin-cli.sh -rpcwallet=multisig getbalance) BTC"
echo "Replenisher balance before: $($THIS_DIR/bitcoin-cli.sh -rpcwallet=replenisher getbalance) BTC"
NUM_TRANSFERS=4
npx hardhat --network integration-test free-money 0xB3b77A8Bc6b6fD93D591C0F34f202eC02e9af2e8 5
npx hardhat --network integration-test transfer-rbtc-to-btc 0xc1daad254b7005eca65780d47213d3de15bd92fcce83777487c5082c6d27600a bcrt1qq8zjw66qrgmynrq3gqdx79n7fcchtaudq4rrf2 0.15 --bridge-address 0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9 --repeat $NUM_TRANSFERS
npx hardhat --network integration-test transfer-rbtc-to-btc 0xc1daad254b7005eca65780d47213d3de15bd92fcce83777487c5082c6d27600a bcrt1qq8zjw66qrgmynrq3gqdx79n7fcchtaudq4rrf0 0.15 --bridge-address 0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9 --repeat $NUM_TRANSFERS

echo "$NUM_TRANSFERS invalid transfers sent, followed by $NUM_TRANSFERS transfers to proper addresses. They should be visible in a couple of minutes"
echo "Polling balances, Ctrl-C to exit"
while true ; do
    echo "User: $($THIS_DIR/bitcoin-cli.sh -rpcwallet=user getbalance)  Multisig: $($THIS_DIR/bitcoin-cli.sh -rpcwallet=multisig getbalance)  Replenisher: $($THIS_DIR/bitcoin-cli.sh -rpcwallet=replenisher getbalance)"
    sleep 10
done
