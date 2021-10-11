import {Network, SharedSecretAuth} from 'ataraxia';
import {TCPTransport} from 'ataraxia-tcp';
import {Config} from '../config';
import {RSKKeyedAuth} from "./auth";
import {Contract, Signer} from "ethers";

export function createNetwork(config: Config, signer: Signer, bridgeContract: Contract): Network {
    const transport = new TCPTransport({
        port: config.port,
        authentication: [
            new RSKKeyedAuth({
                getPeerAddresses: async () => await bridgeContract.federators(),
                signer: signer
            }),
        ]
    });

    for (let peer of config.knownPeers) {
        const [host, port] = peer.split(':');
        transport.addManualPeer({
            host,
            port: parseInt(port),
        });
    }

    return new Network({
        name: 'fastbtc2',
        transports: [
            transport,
        ]
    })
}

export const P2PNetwork = Symbol.for('P2PNetwork');
export {Network};
