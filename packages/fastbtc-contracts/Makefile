.PHONY: build
build: artifacts

.flag-yarn-installed: package.json
	yarn
	touch .flag-yarn-installed

artifacts: .flag-yarn-installed package.json tsconfig.json yarn.lock contracts hardhat.config.ts
	yarn build
	touch artifacts

yarn.lock: package.json
	yarn

.PHONY: test
test: build
	yarn test
