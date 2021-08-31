########
# base #
########
FROM node:14-alpine AS base

RUN apk update


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

RUN ls node_modules

###################
# the final image #
###################
FROM alpine:3.14

RUN apk update
RUN apk add nodejs --no-cache
RUN node --version

COPY --from=builder /app /app

WORKDIR /app

EXPOSE 7777

CMD [ "node", "./dist/index.js" ]
