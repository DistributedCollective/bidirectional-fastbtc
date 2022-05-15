#!/bin/bash
set -e
cd "$(dirname "$0")"
THIS_DIR=$(pwd)
cd ../../packages/fastbtc-contracts

DOCKER_COMPOSE="docker-compose -f ../../docker-compose-base.yml -f ../../docker-compose-regtest.yml"
NUM_TRANSFERS=4
TRANSFER_AMOUNT=1
TRANSFER_AMOUNT_AFTER_FEES=0.999895
REQUIRED_RBTC="$(echo "$NUM_TRANSFERS * $TRANSFER_AMOUNT" | bc)"

echo "Testing user reclaiming"
npx hardhat --network integration-test set-required-blocks-before-reclaim 0
#npx hardhat --network integration-test set-limits --max-btc 2  # Not needed, it's already like this
npx hardhat --network integration-test free-money 0xB3b77A8Bc6b6fD93D591C0F34f202eC02e9af2e8 $REQUIRED_RBTC
echo ""
BTC_BALANCE="$($THIS_DIR/bitcoin-cli.sh -rpcwallet=user getbalance)"
echo "User BTC balance before:  $BTC_BALANCE BTC"
RBTC_BALANCE="$(npx hardhat --network integration-test get-rbtc-balance 0xB3b77A8Bc6b6fD93D591C0F34f202eC02e9af2e8 pending)"
echo "User rBTC balance before: $RBTC_BALANCE rBTC"
FIRST_NONCE=$(npx hardhat --network integration-test get-next-nonce bcrt1qq8zjw66qrgmynrq3gqdx79n7fcchtaudq4rrf0)
echo "First transfer nonce:     $FIRST_NONCE"
echo ""

npx hardhat --network integration-test transfer-rbtc-to-btc 0xc1daad254b7005eca65780d47213d3de15bd92fcce83777487c5082c6d27600a bcrt1qq8zjw66qrgmynrq3gqdx79n7fcchtaudq4rrf0 $TRANSFER_AMOUNT --bridge-address 0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9 --repeat $NUM_TRANSFERS

echo "$NUM_TRANSFERS transfers were sent"

echo ""
echo "User BTC balance after:   $($THIS_DIR/bitcoin-cli.sh -rpcwallet=user getbalance) BTC"
RBTC_BALANCE="$(npx hardhat --network integration-test get-rbtc-balance 0xB3b77A8Bc6b6fD93D591C0F34f202eC02e9af2e8 pending)"
echo "User rBTC balance after:  $RBTC_BALANCE rBTC"
let "FIRST_RECLAIMED_NONCE = FIRST_NONCE + 1"
let "SECOND_RECLAIMED_NONCE = FIRST_NONCE + 2"
echo "First nonce to reclaim:   $FIRST_RECLAIMED_NONCE"
echo "Second nonce to reclaim:  $SECOND_RECLAIMED_NONCE"

echo "First reclaiming"
npx hardhat --network integration-test reclaim-transfer 0xc1daad254b7005eca65780d47213d3de15bd92fcce83777487c5082c6d27600a bcrt1qq8zjw66qrgmynrq3gqdx79n7fcchtaudq4rrf0 $FIRST_RECLAIMED_NONCE
EXPECTED_RBTC_BALANCE=$(echo "$RBTC_BALANCE + $TRANSFER_AMOUNT" | bc)
RBTC_BALANCE="$(npx hardhat --network integration-test get-rbtc-balance 0xB3b77A8Bc6b6fD93D591C0F34f202eC02e9af2e8)"
echo "rBTC balance after reclaim: $RBTC_BALANCE"
echo "^-- should be close to:     $EXPECTED_RBTC_BALANCE (not exactly because of gas fees)"

sleep 5

echo "Polling balances and waiting for the right moment to reclaim the second one."
while true ; do
    RBTC_BALANCE="$(npx hardhat --network integration-test get-rbtc-balance 0xB3b77A8Bc6b6fD93D591C0F34f202eC02e9af2e8)"
    BTC_BALANCE="$($THIS_DIR/bitcoin-cli.sh -rpcwallet=user getbalance)"

    # This is stupid and frail but whatever
    #MATCHED_LOGS="$($DOCKER_COMPOSE logs --tail 100 node1 node2 node3 | grep -ie 'Gathered .* RSK sending signatures' || true)"
    MATCHED_LOGS="$($DOCKER_COMPOSE logs --tail 50 node1 node2 node3 | grep -ie 'TransferBatch does not have enough RSK sending signatures' || true)"

    if [ -z "$MATCHED_LOGS" ] ; then
        echo "rbtc: $RBTC_BALANCE, btc: $BTC_BALANCE, not reclaiming yet"
    else
        echo "rbtc: $RBTC_BALANCE, btc: $BTC_BALANCE"
        echo "It's now an optimally devious time to do the second reclaim, so doing that."
        EXPECTED_RBTC_BALANCE=$(echo "$RBTC_BALANCE + $TRANSFER_AMOUNT" | bc)
        npx hardhat --network integration-test reclaim-transfer 0xc1daad254b7005eca65780d47213d3de15bd92fcce83777487c5082c6d27600a bcrt1qq8zjw66qrgmynrq3gqdx79n7fcchtaudq4rrf0 $SECOND_RECLAIMED_NONCE
        RBTC_BALANCE=$(npx hardhat --network integration-test get-rbtc-balance 0xB3b77A8Bc6b6fD93D591C0F34f202eC02e9af2e8)
        echo "rBTC balance after reclaim: $RBTC_BALANCE"
        echo "^-- should be close to:     $EXPECTED_RBTC_BALANCE (not exactly because of gas fees)"
        break
    fi

    sleep 0.5
done

EXPECTED_FINAL_BTC_BALANCE=$(echo "($NUM_TRANSFERS - 2) * $TRANSFER_AMOUNT_AFTER_FEES + $BTC_BALANCE" | bc)

echo "Polling balances and waiting for the right moment to reclaim the second one. Ctrl-C to exit"
while true ; do
    RBTC_BALANCE=$(npx hardhat --network integration-test get-rbtc-balance 0xB3b77A8Bc6b6fD93D591C0F34f202eC02e9af2e8)
    BTC_BALANCE="$($THIS_DIR/bitcoin-cli.sh -rpcwallet=user getbalance)"
    echo "rbtc: $RBTC_BALANCE, btc: $BTC_BALANCE, eventual expected btc balance: $EXPECTED_FINAL_BTC_BALANCE"

    sleep 10
done
