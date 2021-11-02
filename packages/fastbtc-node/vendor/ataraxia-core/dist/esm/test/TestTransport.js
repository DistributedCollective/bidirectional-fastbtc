import { AbstractTransport } from 'ataraxia-transport';
/**
 * Transport suitable for use with tests, only support manual adding of peers.
 * Peers usable with this transport can be created via `peersBetween`.
 */
export class TestTransport extends AbstractTransport {
    constructor() {
        super('test');
    }
    addPeer(peer) {
        super.addPeer(peer);
    }
}
//# sourceMappingURL=TestTransport.js.map