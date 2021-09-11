# This Makefile is a bit different since we mostly rely on
# docker to run the node
.PHONY: build
build: src/rsk/abi

src/rsk/abi: ../fastbtc-contracts/contracts
	cd ../fastbtc-contracts && make
	node copy-abi.js
	touch src/rsk/abi
