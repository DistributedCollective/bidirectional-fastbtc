# Build stage for BerkeleyDB
FROM containerregistry.sovryn.app/sovryn-bitcoind-base:latest

COPY docker-entrypoint.sh /entrypoint.sh

COPY bitcoin.conf /bitcoin.conf
RUN chown -R bitcoin: /home/bitcoin/

USER bitcoin

# No volume so that the container will be emptied for free!
# VOLUME ["/home/bitcoin/.bitcoin"]

EXPOSE 18443 18444

ENTRYPOINT ["/entrypoint.sh"]

RUN bitcoind -version | grep "Bitcoin Core version v${BITCOIN_VERSION}"
