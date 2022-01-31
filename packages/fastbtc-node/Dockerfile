########
# base #
########
FROM node:14-alpine AS base

RUN apk update
# Requirements for libsodium/gyp/etc
RUN apk add -t build-dependencies libtool autoconf automake gcc g++ make python2 python3


###########
# builder #
###########
FROM base AS builder

WORKDIR /app

COPY package.json yarn.lock tsconfig.json ./
COPY vendor /app/vendor

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
FROM alpine:3.14

RUN apk update
RUN apk add nodejs curl --no-cache
RUN node --version

COPY --from=builder /app /app

WORKDIR /app

EXPOSE 7777

CMD [ "node", "--enable-source-maps", "--trace-warnings", "./startup.js" ]
