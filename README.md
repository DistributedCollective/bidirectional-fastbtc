FastBTC v5 +
============

Everybody loves FastBTC. The new iteration has the following features:

- Bi-directional transfers, ie. RSK-to-BTC as well as the classic BTC-to-RSK
- Improved BTC-to-RSK transfers using PowPeg improvements in RSK Iris release (3.x) (UPCOMING)

**EVERYTHING IS STILL WORK IN PROGRESS**

Demo
----

Running the demo requires installing the following packages:
- docker
- postgresql
- node.js
- jq
- yarn
- python 3 or 2 (pre-installed system python is probably enough)
- bitcoin-core (bitcoind and bitcoin-cli)

Run the demo with these steps (TODO: make it single-command with better docker-compose config):

```
# tab 1:
./demo/start_services_for_docker_compose.sh
# tab 2 (after the first thing says all done)
rm -rf pgdata  # remove postgresql data directory if it exists
docker-compose up --build
# tab 3
./demo/show_user_wallet_details.sh
./demo/transfer_rbtc_from_user.sh
# wait a while (max couple of minutes)
./demo/show_user_wallet_details.sh  # should show updated balance
```

To access the UI:
```
cd packages/fastbtc-ui
yarn
yarn start
```

Add the following custom RPC to metamask:
```
url: http://localhost:8545
chain id: 31337
```

And then go to http://localhost:3000 in your browser.

The demo commands spit out a private key that already has rBTC
(and that you can import to Metamask), but to get rBTC to other wallets
you can run the following:
```
cd packages/fastbtc-contracts
npx hardhat --network localhost free-money 0x123123 1.23
```
(where `0x123123` is your rsk address and `1.23` is the amount)

A note about secrets and private keys
-------------------------------------

The `demo` directory includes some private keys for the Bitcoin and RSK networks. These are generated
exclusively for the project and are meant to be in Git, but please do not use them with real money.
