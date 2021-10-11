#!/bin/bash
set -e
cd "$(dirname "$0")"

trap "./stop_all.sh" EXIT

echo "Starting demo backend services"
./start_demo_blockchain.sh
./start_demo_bitcoind.sh
#./start_demo_frontend.sh  # Not necessary

echo "Demo backend services started"

./fund_accounts.sh

echo 'All done.'
echo 'Run `docker-compose up` in the root directory to start the backend'
sleep 5

./start_bitcoin_mining.sh
