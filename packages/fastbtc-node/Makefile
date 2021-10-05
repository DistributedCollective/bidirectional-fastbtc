# This Makefile is a bit different since we mostly rely on
# docker to run the node
.PHONY: build

build: .flag-yarn-installed src/rsk/abi startup.js

.flag-yarn-installed: package.json
	yarn
	touch $@

src/rsk/abi: ../fastbtc-contracts/contracts
	cd ../fastbtc-contracts && make
	node copy-abi.js
	touch src/rsk/abi
