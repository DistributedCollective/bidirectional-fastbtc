FastBTC 2
=========

Everybody loves FastBTC. The new iteration has the following features:

- Bi-directional transfers, ie. RSK-to-BTC as well as the classic BTC-to-RSK
- Improved BTC-to-RSK transfers using PowPeg improvements in RSK Iris release (3.x) (UPCOMING)

**EVERYTHING IS IN PROTOTYPE STAGE AT THE MOMENT**

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
docker-compose up --build
# tab 3
./demo/show_user_wallet_details.sh
./demo/transfer_rbtc_from_user.sh
# wait a while (max couple of minutes)
./demo/show_user_wallet_details.sh  # should show updated balance
```

You can also access the UI at http://localhost:8080 (add the private key from output to metamask)
to transfer rBTC
