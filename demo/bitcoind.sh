#!/bin/bash

THIS_DIR="$(cd $(dirname "$0") && pwd)"

if which bitcoin-core.daemon >/dev/null 2>/dev/null ; then
    CMD="bitcoin-core.daemon"
elif which bitcoind >/dev/null 2>/dev/null ; then
    CMD="bitcoind"
else
    echo "bitcoin-core.daemon or bitcoind required"
    exit 1
fi

$CMD -conf=$THIS_DIR/bitcoin.conf "$@"
