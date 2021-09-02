import { Network, AnonymousAuth } from 'ataraxia';
import { TCPTransport } from 'ataraxia-tcp';
import {Config} from '../config';

export function createNetwork(config: Config): Network {
    const transport = new TCPTransport({
        port: config.port,
        authentication: [
            // TODO: create RSK based authentication
            new AnonymousAuth(),
        ]
    });
    for(let peer of config.knownPeers) {
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
export { Network };
