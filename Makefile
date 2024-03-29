all:
	@echo "Pick a target:"
	@echo "  * run-demo-regtest"
	@echo "        runs services in regtest mode"
	@echo "  * run-testnet"
	@echo "        runs services in testnet mode with permanent db"

.PHONY: run-demo-regtest
run-demo-regtest: packages/fastbtc-node/version.json
	@docker-compose -f docker-compose-base.yml down --remove-orphans && \
		docker-compose -f docker-compose-base.yml -f docker-compose-regtest.yml up --build --force-recreate

# NOTE: when adding new test cases with env vars, remember to re-export them in docker-compose-regtest.yml
.PHONY: run-demo-regtest-replenisher-very-small-coins
run-demo-regtest-replenisher-very-small-coins: packages/fastbtc-node/version.json
	@export TEST_VERY_SMALL_REPLENISHER_COINS=true && make run-demo-regtest
.PHONY: run-demo-regtest-replenisher-limits
run-demo-regtest-replenisher-limits: packages/fastbtc-node/version.json
	@export TEST_REPLENISHER_LIMITS=true && make run-demo-regtest
.PHONY: run-demo-regtest-slow-replenisher
run-demo-regtest-slow-replenisher: packages/fastbtc-node/version.json
	@export TEST_SLOW_REPLENISHER=true && make run-demo-regtest

.PHONY: show-node-logs
show-node-logs:
	@docker-compose -f docker-compose-base.yml -f docker-compose-regtest.yml logs -f node1 node2 node3

.PHONY: build-regtest-bitcoin
build-regtest-bitcoin:
	@(cd integration_test/bitcoind-regtest \
	  && docker build . -t containerregistry.sovryn.app/sovryn-bitcoind-base:latest -f Dockerfile.bitcoind-base)

.PHONY: build-regtest-bitcoin-parallel
build-regtest-bitcoin-parallel:
	@(cd integration_test/bitcoind-regtest \
	  && docker build . --build-arg BITCOIND_PARALLEL=-j8 -t containerregistry.sovryn.app/sovryn-bitcoind-base:latest -f Dockerfile.bitcoind-base)

.PHONY: test-transfers
test-transfers:
	@cd packages/fastbtc-contracts && make
	@integration_test/scripts/test_example_transfer.sh

.PHONY: test-transfers-big-amounts
test-transfers-big-amounts:
	@cd packages/fastbtc-contracts && make
	@integration_test/scripts/test_example_transfer_big_amounts.sh

.PHONY: test-reclaiming
test-reclaiming:
	@cd packages/fastbtc-contracts && make
	@integration_test/scripts/test_user_reclaiming.sh

.PHONY: run-testnet
run-testnet:
	@docker-compose -f docker-compose-base.yml -f docker-compose-testnet.yml up --build

.PHONY: test
test:
	@echo "Testing fastbtc-contracts"
	cd packages/fastbtc-contracts && make test
	@echo "Testing fastbtc-node"
	cd packages/fastbtc-node && make test


# This is required for startup, so we'll create a dummy version if it doesn't exist
packages/fastbtc-node/version.json:
	@if test -f packages/fastbtc-node/version.json ; \
  		then touch packages/fastbtc-node/version.json ; \
  		else echo "{}" > packages/fastbtc-node/version.json; \
  		fi

