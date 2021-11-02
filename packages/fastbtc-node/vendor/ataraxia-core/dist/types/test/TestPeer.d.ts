import { Peer } from 'ataraxia-transport';
export interface TestPeer extends Peer {
    connect(): void;
}
/**
 * Create a pair of peers that are mirrors of each other, the first peer sends
 * to the second pair and vice-versa.
 *
 * @param first -
 *   id of first peer
 * @param second -
 *   if of second peer
 * @returns
 *   array where the first entry represent a connection from the first peer
 *   to the second peer and the second entry represent a connection from the
 *   second peer to the first peer
 */
export declare function peersBetween(first: ArrayBuffer, second: ArrayBuffer): [TestPeer, TestPeer];
//# sourceMappingURL=TestPeer.d.ts.map