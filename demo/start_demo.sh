#!/bin/bash
set -e
cd "$(dirname "$0")"

trap "./stop_all.sh" EXIT

echo "Starting demo"
./start_demo_blockchain.sh
./start_demo_frontend.sh
./start_demo_backend.sh

echo "Demo started"

./fund_accounts.sh

echo "tailing logs"
./tail_logs.sh
