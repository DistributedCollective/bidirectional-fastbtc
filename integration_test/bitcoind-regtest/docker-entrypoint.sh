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

##################################################################################################################
#                                                                                                                #
#             !!! Time for some explanation of the different test cases in this whole spaghetti !!!              #
#             =====================================================================================              #
#                                                                                                                #
##################################################################################################################
#
# - In the default scenario, we mine funds to the replenisher wallet. We then implicitly test that replenishment
#   works OK and funds get sent to the multisig, and then to the user.
# - If TEST_VERY_SMALL_REPLENISHER_COINS=true, we test the regression where the number of inputs in a
#   replenishment transaction was not capped, which resulted in some cases in a tx with >1000 inputs. This caused
#   the call to bitcoin rpc to take a loooong time, which caused a timeout in ataraxia. And probably such a transaction
#   would not have passed in the blockchain anyway.
# - If TEST_REPLENISHER_LIMITS is true, we send some funds to the multisig -- enough that the replenisher doesn't get
#   triggered (as long as the number matches the one configured in the backend) -- and the rest to the replenisher
#   wallet. This is meant to test the case where a new TransferBatch cannot be created because the multisig doesn't
#   have enough funds, but the replenisher doesn't trigger either because the balance is over the threshold.
#
# Ugh.
echo "Test settings:"
echo "TEST_VERY_SMALL_REPLENISHER_COINS=$TEST_VERY_SMALL_REPLENISHER_COINS"
echo "TEST_REPLENISHER_LIMITS=$TEST_REPLENISHER_LIMITS"

# We need a temporary address for both of these cases, because we need to send amounts smaller than the block reward.
if [[ "$TEST_VERY_SMALL_REPLENISHER_COINS" = "true" ||  "$TEST_REPLENISHER_LIMITS" = "true" ]]
then
    echo "Creating temporary wallet address"
    bitcoin-cli createwallet temporary
    TEMPORARY_ADDRESS=$(bitcoin-cli -rpcwallet=temporary getnewaddress)
    echo "Temporary address: $TEMPORARY_ADDRESS"
    echo "Generating 200 blocks to the temporary address"
    bitcoin-cli -rpcwallet=temporary generatetoaddress 200 "$TEMPORARY_ADDRESS" > /dev/null
    echo "Balance of temporary address:"
    bitcoin-cli -rpcwallet=temporary getbalance
    # Set TX fee, very much needed for sending new transactions
    bitcoin-cli -rpcwallet=temporary settxfee 0.00001
else
    TEMPORARY_ADDRESS="temporary_address_not_created_because_not_TEST_VERY_SMALL_REPLENISHER_COINS_or_TEST_REPLENISHER_LIMITS"
fi

if [[ "$TEST_VERY_SMALL_REPLENISHER_COINS" = "true" ]]
then
    # This is here to test the case where the replenisher wanted to sign a TX with 1000 inputs.
    # This doesn't play well with bitcoin-cli
    echo "TEST_VERY_SMALL_REPLENISHER_COINS = true, seeding the replenisher with multiple coins of 0.001 in size"
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
elif [[ "$TEST_REPLENISHER_LIMITS" = "true" ]]
then
    echo "Sending 5.5 BTC to the multisig (should be just over the threshold)..."
    bitcoin-cli -rpcwallet=temporary sendtoaddress "$MULTISIG_ADDRESS" 5.5 > /dev/null
else
    echo "Generating 101+ blocks (sending balance to replenisher wallet, not directly to multisig)..."
    echo "Init replenisher funds"
    for i in $(bitcoin-cli deriveaddresses "$REPLENISHER_SOURCE_DESCRIPTOR" '[5,10]'|cut -f 2 -d '"'|grep bc)
    do
        echo "Mine a block $(date '+%d/%m/%Y %H:%M:%S') for $i"
        bitcoin-cli -rpcwallet=replenisher generatetoaddress 1 "$i" > /dev/null
    done
    for i in $(bitcoin-cli deriveaddresses "$REPLENISHER_SOURCE_DESCRIPTOR" '[11,12]'|cut -f 2 -d '"'|grep bc)
    do
        echo "Mine a block $(date '+%d/%m/%Y %H:%M:%S') for $i"
        # sending to replenisher here, not multisig
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
        if [[ "$TEST_VERY_SMALL_REPLENISHER_COINS" = "true" ]]
        then
            # generating to temporary address and then sending to replenisher
            bitcoin-cli -rpcwallet=replenisher generatetoaddress 1 "$TEMPORARY_ADDRESS" > /dev/null
            bitcoin-cli -rpcwallet=temporary sendtoaddress "$i" 0.001 > /dev/null
        elif [[ "$TEST_REPLENISHER_LIMITS" = "true" ]]
        then
            # Mine to temporary address, send 5 btc to the replenisher
            bitcoin-cli -rpcwallet=replenisher generatetoaddress 1 "$TEMPORARY_ADDRESS" > /dev/null
            bitcoin-cli -rpcwallet=temporary sendtoaddress "$i" 5.0 > /dev/null
        else
            # sending to replenisher here, not multisig
            bitcoin-cli -rpcwallet=replenisher generatetoaddress 1 "$i" > /dev/null
        fi
        sleep 1
    done
done

