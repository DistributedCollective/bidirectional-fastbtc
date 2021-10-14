set -e
cd "$(dirname "$0")"
THIS_DIR=$(pwd)

echo "User balance: $(./bitcoin-cli.sh -rpcwallet=user getbalance) BTC"
