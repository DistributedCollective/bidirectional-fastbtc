# base
FROM node:14-alpine AS base

RUN apk update

# builder
FROM base AS builder

WORKDIR /app

COPY package.json yarn.lock tsconfig.json ./

RUN yarn install

COPY src /app/src

RUN ls -a; yarn build

EXPOSE 7777

# the final image
FROM base

COPY --from=builder /app /app
WORKDIR /app

CMD [ "node", "./dist/index.js" ]
