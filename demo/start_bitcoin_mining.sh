set -e
cd "$(dirname "$0")"
THIS_DIR=$(pwd)
INTERVAL=20
ADDRESS=$(jq -r '.bitcoin.multisig.address' "$THIS_DIR/test_accounts.json")

echo "Starting automining - generating a block every $INTERVAL s (rewards go to $ADDRESS)"

while true
do
        echo "Mine a block $(date '+%d/%m/%Y %H:%M:%S')"
        bitcoin-cli -conf=$THIS_DIR/bitcoin.conf generatetoaddress 1 $ADDRESS
        sleep $INTERVAL
done
