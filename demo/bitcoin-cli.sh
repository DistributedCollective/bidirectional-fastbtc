#!/bin/bash

THIS_DIR="$(cd $(dirname "$0") && pwd)"

if which bitcoin-core.cli >/dev/null 2>/dev/null ; then
    CMD="bitcoin-core.cli"
elif which bitcoin-cli >/dev/null 2>/dev/null ; then
    CMD="bitcoin-cli"
else
    echo "bitcoin-core.cli or bitcoin-cli required"
    exit 1
fi

$CMD -conf=$THIS_DIR/bitcoin.conf "$@"
