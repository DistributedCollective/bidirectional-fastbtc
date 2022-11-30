########
# base #
########
FROM node:14-bullseye AS base

RUN apt-get update
# Requirements for libsodium/gyp/etc
RUN apt-get install -y build-essential libtool autoconf automake gcc g++ make python3


###########
# builder #
###########
FROM base AS builder

WORKDIR /app

COPY package.json yarn.lock tsconfig.json ./

RUN node --version
RUN yarn install --frozen-lockfile

COPY src /app/src

RUN ls -a; yarn build

RUN yarn install --production=true --frozen-lockfile

COPY ormconfig.js startup.js ./

COPY src/scripts /app/scripts

RUN ls node_modules

COPY version.json ./

###################
# the final image #
###################
FROM node:14-bullseye

RUN apt-get update
RUN apt-get install -y curl
RUN node --version

COPY --from=builder /app /app

WORKDIR /app

EXPOSE 7777

CMD [ "node", "--enable-source-maps", "--trace-warnings", "./startup.js" ]
