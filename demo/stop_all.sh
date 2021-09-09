#!/bin/bash
cd "$(dirname "$0")"
THIS_DIR=$(pwd)
for f in $THIS_DIR/run/*.pid
do
    echo "Stopping $f"
    kill $(cat $f) 2>/dev/null && rm $f || true
done
