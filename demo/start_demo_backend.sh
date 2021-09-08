#!/bin/bash
set -e
cd "$(dirname "$0")"

echo "Building docker"
docker build -t fastbtc:latest ../packages/fastbtc-node

echo ""
echo "Resetting databases"
createuser fastbtc 2>/dev/null || true
(dropdb fastbtc2 || true) && createdb -O fastbtc fastbtc2
(dropdb fastbtc2_node2 || true) && createdb -O fastbtc fastbtc2_node2
(dropdb fastbtc2_node3 || true) && createdb -O fastbtc fastbtc2_node3

echo ""
echo "Starting node 1"
docker run --env-file docker-env1 -p 11125:11125 fastbtc:latest &
PID1=$!
echo PID1: $PID1
sleep 5

echo ""
echo "Starting node 2"
docker run --env-file docker-env2 -p 11126:11126 fastbtc:latest &
PID2=$!
echo PID2: $PID2
trap "echo stopping $PID1 and $PID2 && kill $PID1 $PID2 && sleep 5" SIGINT SIGTERM EXIT

echo ""

while true ; do
    sleep 1
done
