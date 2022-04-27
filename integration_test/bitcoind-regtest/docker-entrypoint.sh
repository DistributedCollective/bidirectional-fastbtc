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
# bitcoin-cli createwallet replenisher1 false true || true
# bitcoin-cli createwallet replenisher2 false true || true
# bitcoin-cli -rpcwallet=replenisher1 sethdseed true "$REPLENISHER1_HDSEED"
# bitcoin-cli -rpcwallet=replenisher2 sethdseed true "$REPLENISHER2_HDSEED"
# bitcoin-cli createmultisig 2 "$REPLENISHER_PUBKEYS" bech32  # probably not necessary
# bitcoin-cli -rpcwallet=replenisher importaddress "$REPLENISHER_ADDRESS"
bitcoin-cli createwallet replenisher true true

ARGS='[{"desc":"'"$REPLENISHER_SOURCE_DESCRIPTOR"'","range":[0,100],"watchonly":true,"label":"pegin","timestamp":0}]'
echo "Importing desciptor: $ARGS"
bitcoin-cli -rpcwallet=replenisher importmulti "$ARGS"
echo "done"

if [ "$TEST_VERY_SMALL_REPLENISHER_COINS" = "true" ]
then
    # This is here to test the case where the replenisher wanted to sign a TX with 1000 inputs.
    # This doesn't play well with bitcoin-cli
    echo "TEST_VERY_SMALL_REPLENISHER_COINS = true, seeding the replenisher with multiple coins of 0.001 in size"
    echo "Creating temporary wallet address"
    bitcoin-cli createwallet temporary
    TEMPORARY_ADDRESS=$(bitcoin-cli -rpcwallet=temporary getnewaddress)
    echo "Temporary address: $TEMPORARY_ADDRESS"
    echo "Generating blocks to the temporary address"
    bitcoin-cli -rpcwallet=temporary generatetoaddress 200 "$TEMPORARY_ADDRESS" > /dev/null
    echo "Balance of temporary address:"
    bitcoin-cli -rpcwallet=temporary getbalance
    # Set TX fee, very much needed for sending new transactions
    bitcoin-cli -rpcwallet=temporary settxfee 0.00001

    echo "Sending very small coins to the replenisher address (in 5s)"
    echo "This will take a long time."
    sleep 5
    for iteration in 1 2 3 4 5 6 7 8 9 10
    do
        echo "start iteration $iteration/10"
        for i in $(bitcoin-cli deriveaddresses "$REPLENISHER_SOURCE_DESCRIPTOR" '[5,110]'|cut -f 2 -d '"'|grep bc)
        do
            echo "iteration $iteration/10: $i"
            bitcoin-cli -rpcwallet=temporary sendtoaddress "$i" 0.001 > /dev/null
            #bitcoin-cli -rpcwallet=temporary getbalance
        done
    done
    echo "Small coins sent"
else
    echo "Generating 101 blocks (sending balance to replenisher wallet, not directly to multisig)..."
    echo "Init replenisher funds"
    for i in $(bitcoin-cli deriveaddresses "$REPLENISHER_SOURCE_DESCRIPTOR" '[5,10]'|cut -f 2 -d '"'|grep bc)
    do
        echo "Mine a block $(date '+%d/%m/%Y %H:%M:%S') for $i"
        # Also sending to replenisher here, not multisig
        bitcoin-cli -rpcwallet=replenisher generatetoaddress 1 "$i" > /dev/null
    done
    for i in $(bitcoin-cli deriveaddresses "$REPLENISHER_SOURCE_DESCRIPTOR" '[11,12]'|cut -f 2 -d '"'|grep bc)
    do
        echo "Mine a block $(date '+%d/%m/%Y %H:%M:%S') for $i"
        # Also sending to replenisher here, not multisig
        bitcoin-cli -rpcwallet=replenisher generatetoaddress 50 "$i" > /dev/null
    done
fi

echo "Balance of replenisher:"
bitcoin-cli -rpcwallet=replenisher getbalance

echo "Balance of multisig:"
bitcoin-cli -rpcwallet=multisig getbalance

while true
do
    for i in $(bitcoin-cli deriveaddresses "$REPLENISHER_SOURCE_DESCRIPTOR" '[5,100]'|cut -f 2 -d '"'|grep bc)
    do
        echo "Mine a block $(date '+%d/%m/%Y %H:%M:%S') for $i"
        if [ "$TEST_VERY_SMALL_REPLENISHER_COINS" = "true" ]
        then
            # generating to temporary address and then sending to replenisher
            bitcoin-cli -rpcwallet=replenisher generatetoaddress 1 "$TEMPORARY_ADDRESS" > /dev/null
            bitcoin-cli -rpcwallet=temporary sendtoaddress "$i" 0.001 > /dev/null
        else
            # sending to replenisher here, not multisig
            bitcoin-cli -rpcwallet=replenisher generatetoaddress 1 "$i" > /dev/null
        fi
        sleep 1
    done
done

