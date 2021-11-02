import { AbstractTransport, Peer } from 'ataraxia-transport';
/**
 * Transport suitable for use with tests, only support manual adding of peers.
 * Peers usable with this transport can be created via `peersBetween`.
 */
export declare class TestTransport extends AbstractTransport {
    constructor();
    addPeer(peer: Peer): void;
}
//# sourceMappingURL=TestTransport.d.ts.map