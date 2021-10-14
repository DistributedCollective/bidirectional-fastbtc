set -e
cd "$(dirname "$0")"
THIS_DIR=$(pwd)

echo "User balance: $(bitcoin-core.cli -conf=$THIS_DIR/bitcoin.conf -rpcwallet=user getbalance) BTC"
