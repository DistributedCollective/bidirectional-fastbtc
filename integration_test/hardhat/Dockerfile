########
# base #
########
FROM node:14-alpine AS fastbtc-hardhat-base

RUN apk update
# Requirements for libsodium/gyp/etc
RUN apk add -t build-dependencies libtool autoconf automake gcc g++ make python3
RUN apk add git


###########
# builder #
###########
FROM fastbtc-hardhat-base AS fastbtc-hardhat-builder

# RUN apk add git

WORKDIR /app

COPY contracts/ ./contracts
COPY deploy/ ./deploy
COPY scripts/ ./scripts
COPY test/ ./test
COPY package.json hardhat.config.ts tsconfig.json yarn.lock ./

RUN git --version
RUN yarn
RUN yarn build
RUN ls

###################
# the final image #
###################
FROM alpine:3.14

RUN apk update && apk add nodejs npm --no-cache
RUN node --version

COPY --from=fastbtc-hardhat-builder /app /app
WORKDIR /app
RUN ls


EXPOSE 7777

# Add federators and fund accounts
# TODO: not sure if funding here is the best bet or if it should be done for each test individually
RUN echo -e '#!/bin/sh\n\
(sleep 20\n\
npx hardhat --network localhost add-federator $NODE1_ADDRESS $NODE2_ADDRESS $NODE3_ADDRESS\n\
npx hardhat --network localhost free-money $USER_ADDRESS 10.0\n\
npx hardhat --network localhost free-money $NODE1_ADDRESS 10.0\n\
npx hardhat --network localhost free-money $NODE2_ADDRESS 10.0\n\
npx hardhat --network localhost free-money $NODE3_ADDRESS 10.0\n\
npx hardhat --network localhost set-mining-interval 10000)&\n\
npx hardhat node --hostname 0.0.0.0\n\
' > start.sh && chmod +x start.sh

CMD [ "./start.sh" ]
