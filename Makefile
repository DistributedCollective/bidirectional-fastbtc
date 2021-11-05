all:
	@echo "Pick a target:"
	@echo "  * run-demo-regtest"
	@echo "        runs services in regtest mode"
	@echo "  * run-testnet"
	@echo "        runs services in testnet mode with permanent db"

run-demo-regtest:
	@docker-compose down --remove-orphans && \
		docker-compose -f docker-compose.yml -f docker-compose-regtest.yml up --build --force-recreate

run-testnet:
	@docker-compose -f docker-compose.yml -f docker-compose-testnet.yml up --build