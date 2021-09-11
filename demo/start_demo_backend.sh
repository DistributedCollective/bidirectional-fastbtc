#!/bin/bash
set -e
cd "$(dirname "$0")"
THIS_DIR=$(pwd)
for i in 1 2
do
    if test -f "$THIS_DIR/run/node$i.pid" ; then
        echo "Killing existing node$i"
        kill $(cat $THIS_DIR/run/node$i.pid) 2>/dev/null || true
    fi
done

echo "Build backend (may result in filesystem changes)"
pushd ../packages/fastbtc-node
make
popd

echo "Building docker"
docker build -t fastbtc:latest ../packages/fastbtc-node

echo ""
echo "Resetting databases"
createuser fastbtc 2>/dev/null || true
(dropdb fastbtc2 || true) && createdb -O fastbtc fastbtc2
(dropdb fastbtc2_node2 || true) && createdb -O fastbtc fastbtc2_node2
(dropdb fastbtc2_node3 || true) && createdb -O fastbtc fastbtc2_node3

echo ""
echo "Starting nodes"
for i in 1 2
do
    let "NODE_PORT=11124 + i"
    echo "Starting node $i"
    docker run --env-file docker-env$i -p $NODE_PORT:$NODE_PORT fastbtc:latest \
        2>$THIS_DIR/logs/node$i-error.log >$THIS_DIR/logs/node$i.log &
    NODE_PID=$!
    echo $NODE_PID > $THIS_DIR/run/node$i.pid
    sleep 3
    echo "Node $i started, logs at $THIS_DIR/logs/node$i.log"
    tail $THIS_DIR/logs/node$i-error.log $THIS_DIR/logs/node$i.log
    sleep 2
    echo ""
done
