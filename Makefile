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

.PHONY: show-node-logs
show-node-logs:
	@docker-compose -f docker-compose-base.yml -f docker-compose-regtest.yml logs -f node1 node2 node3

.PHONY: test-transfers
test-transfers:
	@cd packages/fastbtc-contracts && make
	@integration_test/scripts/test_example_transfer.sh

.PHONY: run-testnet
run-testnet:
	@docker-compose -f docker-compose-base.yml -f docker-compose-testnet.yml up --build

# This is required for startup, so we'll create a dummy version if it doesn't exist
packages/fastbtc-node/version.json:
	@if test -f packages/fastbtc-node/version.json ; \
  		then touch packages/fastbtc-node/version.json ; \
  		else echo "{}" > packages/fastbtc-node/version.json; \
  		fi

