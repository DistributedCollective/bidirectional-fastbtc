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
- python 3 or 2

Run the demo with:

```
cd demo
./start_demo.sh
```

Then send RBTC to BTC from the UI at http://localhost:8080 (add the private key from output to metamask)
or by running:
```
./transfer_rbtc_from_user.sh
```


(TODO: use docker and docker-compose for the demo)
