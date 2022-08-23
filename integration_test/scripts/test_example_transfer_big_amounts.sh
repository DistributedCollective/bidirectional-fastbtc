#!/bin/zsh
# bash `let` fails with decimals so let's just use zsh. or maybe we should rewrite this in python
set -e
cd "$(dirname "$0")"
THIS_DIR=$(pwd)
cd ../../packages/fastbtc-contracts
USER_INITIAL_BALANCE="$($THIS_DIR/bitcoin-cli.sh -rpcwallet=user getbalance)"
# percentage fee 0.01 %, fixed fee 500 sat
PERCENTAGE_FEE=0.0001
FIXED_FEE=0.000005
SINGLE_TRANSFER_AMOUNT=3
NUM_TRANSFERS=5
let 'TOTAL_TRANSFERRED=SINGLE_TRANSFER_AMOUNT*NUM_TRANSFERS'
let 'USER_EXPECTED_FINAL_BALANCE=(USER_INITIAL_BALANCE+(TOTAL_TRANSFERRED*(1.0-PERCENTAGE_FEE))-(NUM_TRANSFERS*FIXED_FEE))'
echo "User balance before:         $USER_INITIAL_BALANCE BTC"
echo "User expected balance after: $USER_EXPECTED_FINAL_BALANCE BTC"
echo "Multisig balance before:     $($THIS_DIR/bitcoin-cli.sh -rpcwallet=multisig getbalance) BTC"
echo "Replenisher balance before:  $($THIS_DIR/bitcoin-cli.sh -rpcwallet=replenisher getbalance) BTC"
npx hardhat --network integration-test free-money 0xB3b77A8Bc6b6fD93D591C0F34f202eC02e9af2e8 $TOTAL_TRANSFERRED
echo "Setting max limit to $SINGLE_TRANSFER_AMOUNT BTC"
npx hardhat --network integration-test set-limits --max-btc $SINGLE_TRANSFER_AMOUNT
sleep 1
npx hardhat --network integration-test transfer-rbtc-to-btc 0xc1daad254b7005eca65780d47213d3de15bd92fcce83777487c5082c6d27600a bcrt1qq8zjw66qrgmynrq3gqdx79n7fcchtaudq4rrf0 $SINGLE_TRANSFER_AMOUNT --bridge-address 0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9 --repeat $NUM_TRANSFERS

echo "$NUM_TRANSFERS transfers sent, totaling $TOTAL_TRANSFERRED BTC. They should be visible in a couple of minutes"
echo "Polling balances, Ctrl-C to exit"
while true ; do
    USER_BALANCE="$($THIS_DIR/bitcoin-cli.sh -rpcwallet=user getbalance)"
    BALANCE_MATCHES=$(echo "$USER_BALANCE == $USER_EXPECTED_FINAL_BALANCE" | bc)
    echo "User: $USER_BALANCE  Multisig: $($THIS_DIR/bitcoin-cli.sh -rpcwallet=multisig getbalance)  Replenisher: $($THIS_DIR/bitcoin-cli.sh -rpcwallet=replenisher getbalance)"
    if [[ $BALANCE_MATCHES == 1 ]] ; then
        echo "User balance is the expected final balance -- test success"
        exit 0
    fi
    sleep 10
done
