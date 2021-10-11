set -e
cd "$(dirname "$0")"
THIS_DIR=$(pwd)

echo "User balance: $(bitcoin-cli -conf=$THIS_DIR/bitcoin.conf -rpcwallet=user getbalance) BTC"
