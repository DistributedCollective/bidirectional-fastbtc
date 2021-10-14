#!/bin/bash
set -e
cd "$(dirname "$0")"
THIS_DIR=$(pwd)
DATA_DIR=$THIS_DIR/bitcoindata
CONF_FILE=$THIS_DIR/bitcoin.conf
BITCOIND="bitcoin-core.daemon -conf=$CONF_FILE"
BITCOIN_CLI="bitcoin-core.cli -conf=$CONF_FILE"

if test -f "$THIS_DIR/run/bitcoind.pid" ; then
    echo "Killing existing Bitcoind instance"
    kill $(cat $THIS_DIR/run/bitcoind.pid) 2>/dev/null || true
fi
if test -d "$DATA_DIR" ; then
    echo "Deleting old data dir $DATA_DIR"
    rm -rf $DATA_DIR
fi
mkdir -p $DATA_DIR

echo "Starting Bitcoind in regtest mode"
$BITCOIND >$THIS_DIR/logs/bitcoind.log 2>$THIS_DIR/logs/bitcoind-error.log &
BITCOIND_PID=$!
echo $BITCOIND_BIT > $THIS_DIR/run/bitcoind.pid
echo "Bitcoind started pid $BITCOIND_PID, logs at $THIS_DIR/logs/bitcoind.log"

# Wait for startup
sleep 2

echo "Creating wallets"
$BITCOIN_CLI createwallet node1 false true
$BITCOIN_CLI createwallet node2 false true
$BITCOIN_CLI createwallet node3 false true
$BITCOIN_CLI createwallet user false true
$BITCOIN_CLI -rpcwallet=node1 sethdseed true $(jq -r '.bitcoin.node1.hdseed' $THIS_DIR/test_accounts.json)
$BITCOIN_CLI -rpcwallet=node2 sethdseed true $(jq -r '.bitcoin.node2.hdseed' $THIS_DIR/test_accounts.json)
$BITCOIN_CLI -rpcwallet=node3 sethdseed true $(jq -r '.bitcoin.node3.hdseed' $THIS_DIR/test_accounts.json)
$BITCOIN_CLI -rpcwallet=user sethdseed true $(jq -r '.bitcoin.user.hdseed' $THIS_DIR/test_accounts.json)

PUBKEYS=$(jq -r '.bitcoin.multisig.sortedPublicKeysJson' "$THIS_DIR/test_accounts.json")
echo "Creating multisig for pubkeys: $PUBKEYS"
echo $BITCOIN_CLI createmultisig 2 $PUBKEYS
$BITCOIN_CLI createmultisig 2 $PUBKEYS bech32  # probably not necessary
$BITCOIN_CLI createwallet multisig true true
$BITCOIN_CLI -rpcwallet=multisig importaddress $(jq -r '.bitcoin.multisig.address' "$THIS_DIR/test_accounts.json")

echo "Generating 101 blocks (sending balance to multisig)..."
$BITCOIN_CLI -rpcwallet=multisig generatetoaddress 101 $(jq -r '.bitcoin.multisig.address' "$THIS_DIR/test_accounts.json") > /dev/null
echo "Balance of multisig:"
$BITCOIN_CLI -rpcwallet=multisig getbalance
