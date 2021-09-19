build: .flag-yarn-installed package.json tsconfig.json yarn.lock src
	yarn build

.flag-yarn-installed: package.json
	yarn
	touch $@

yarn.lock: package.json
	yarn
