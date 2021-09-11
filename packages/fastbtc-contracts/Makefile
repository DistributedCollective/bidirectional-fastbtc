.PHONY: build
build: artifacts

artifacts: package.json tsconfig.json yarn.lock contracts hardhat.config.ts
	yarn build
	touch artifacts

yarn.lock: package.json
	yarn
