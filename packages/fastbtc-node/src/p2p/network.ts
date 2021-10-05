import {Network, SharedSecretAuth} from 'ataraxia';
import {TCPTransport} from 'ataraxia-tcp';
import {Config} from '../config';
import {RSKKeyedAuth} from "./auth";
import {Signer} from "ethers";

export function createNetwork(config: Config, signer: Signer): Network {
    const transport = new TCPTransport({
        port: config.port,
        authentication: [
            new RSKKeyedAuth({
                peerAddresses: [
                    "0x4091663B0a7a14e35Ff1d6d9d0593cE15cE7710a",
                    "0x09dcD91DF9300a81a4b9C85FDd04345C3De58F48",
                    "0xA40013a058E70664367c515246F2560B82552ACb",
                ],
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
