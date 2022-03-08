#!/bin/sh
set -e

rm -rf /home/bitcoin/.bitcoin/
mkdir /home/bitcoin/.bitcoin/
cp /bitcoin.conf /home/bitcoin/.bitcoin/bitcoin.conf

echo "Starting Bitcoind in regtest mode"
bitcoind&
BITCOIND_PID=$!
echo "Bitcoind started pid $BITCOIND_PID"

# Wait for startup
sleep 2

echo "Creating wallets"
bitcoin-cli createwallet node1 false true || true
bitcoin-cli createwallet node2 false true || true
bitcoin-cli createwallet node3 false true || true
bitcoin-cli createwallet user  false true || true

bitcoin-cli -rpcwallet=node1 sethdseed true "$NODE1_HDSEED"
bitcoin-cli -rpcwallet=node2 sethdseed true "$NODE2_HDSEED"
bitcoin-cli -rpcwallet=node3 sethdseed true "$NODE3_HDSEED"
bitcoin-cli -rpcwallet=user  sethdseed true "$USER_HDSEED"

bitcoin-cli createmultisig 2 "$PUBKEYS" bech32  # probably not necessary
bitcoin-cli createwallet multisig true true

bitcoin-cli -rpcwallet=multisig importaddress "$MULTISIG_ADDRESS"

# Create replenisher multisig
bitcoin-cli createwallet replenisher1 false true || true
bitcoin-cli createwallet replenisher2 false true || true
bitcoin-cli -rpcwallet=replenisher1 sethdseed true "$REPLENISHER1_HDSEED"
bitcoin-cli -rpcwallet=replenisher2 sethdseed true "$REPLENISHER2_HDSEED"
bitcoin-cli createmultisig 2 "$REPLENISHER_PUBKEYS" bech32  # probably not necessary
bitcoin-cli createwallet replenisher true true
bitcoin-cli -rpcwallet=replenisher importaddress "$REPLENISHER_ADDRESS"

echo "Generating 101 blocks (sending balance to replenisher wallet, not directly to multisig)..."
bitcoin-cli -rpcwallet=multisig generatetoaddress 101 "$REPLENISHER_ADDRESS" > /dev/null

echo "Balance of replenisher:"
bitcoin-cli -rpcwallet=replenisher getbalance

echo "Balance of multisig:"
bitcoin-cli -rpcwallet=multisig getbalance

while true
do
    #echo "Mine a block $(date '+%d/%m/%Y %H:%M:%S')"
    # Also sending to replenisher here, not multisig
    bitcoin-cli generatetoaddress 1 "$REPLENISHER_ADDRESS" > /dev/null
    sleep 5
done

