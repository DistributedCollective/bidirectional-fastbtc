/// <reference types="debug" />
import { Event } from 'atvik';
import { Peer } from 'ataraxia-transport';
import { IdMap } from '../id';
import { TopologyNode } from './TopologyNode';
/**
 * Abstraction to help with finding the best route for a packet.
 */
export declare class Routing {
    /**
     * Debug instance used for logging.
     */
    readonly debug: debug.Debugger;
    /**
     * Reference to the node representing this instance.
     */
    readonly self: TopologyNode;
    /**
     * All the nodes seen.
     */
    private readonly nodes;
    /**
     * Helper to resolve a peer via id.
     */
    private readonly peers;
    /**
     * Event emitted when a node becomes available.
     */
    private readonly availableEvent;
    /**
     * Event emitted when a node becomes unavailable.
     */
    private readonly unavailableEvent;
    /**
     * Flag used to keep track if a routing refresh is needed.
     */
    private dirty;
    constructor(debugNamespace: string, self: TopologyNode, nodes: IdMap<TopologyNode>, peers: (id: ArrayBuffer) => Peer | undefined, availableEvent: Event<any, [TopologyNode]>, unavailableEvent: Event<any, [TopologyNode]>);
    /**
     * Get a peer based on its identifier.
     *
     * @param id -
     *   id of peer
     * @returns
     *   `Peer` if available
     */
    getPeer(id: ArrayBuffer): Peer | undefined;
    /**
     * Mark the routing as dirty to allow it to recalculate the paths.
     */
    markDirty(): void;
    /**
     * Refreshing the routing if it is dirty. This will calculate the best
     * way to reach all nodes and emit events for node availability.
     */
    refresh(): void;
    /**
     * Find the peer used to reach the given node.
     *
     * @param node -
     *   identifier of node
     * @returns
     *   `Peer` if a path is available
     */
    findPeerForTarget(node: ArrayBuffer): Peer | null;
    /**
     * Perform a recalculation of the best paths to take to all nodes. This
     * runs Dijkstra's algorithm to calculate the shortest paths to all nodes.
     */
    private calculatePaths;
}
//# sourceMappingURL=Routing.d.ts.map