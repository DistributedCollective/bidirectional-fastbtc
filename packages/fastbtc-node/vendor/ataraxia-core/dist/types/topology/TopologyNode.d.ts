import { INode } from '@tyriar/fibonacci-heap';
import { Peer, NodeRoutingDetails } from 'ataraxia-transport';
import { Topology } from './Topology';
/**
 * An edge between two nodes.
 */
export interface TopologyEdge {
    /**
     * The cost to traverse this edge.
     */
    readonly cost: number;
    /**
     * Source of the edge.
     */
    readonly source: TopologyNode;
    readonly target: TopologyNode;
}
/**
 * Node in the network topology. Nodes are discovered using broadcasts from
 * peers.
 *
 * Reachability to different peers is tracked in the `reachability` array
 * which is sorted so the shortest path is available as the first element.
 */
export declare class TopologyNode {
    private readonly parent;
    /**
     * Identifier of the node.
     */
    readonly id: ArrayBuffer;
    /**
     * Outgoing connections from this node.
     */
    readonly outgoing: TopologyEdge[];
    /**
     * Incoming connections from this node.
     */
    readonly incoming: TopologyEdge[];
    /**
     * Peer used to reach this node.
     */
    peer?: Peer;
    /**
     * The cost for reaching this node.
     */
    searchCost: number;
    searchPrevious?: TopologyNode;
    searchNode?: INode<number, TopologyNode>;
    /**
     * If this node is directly reachable. Directly reachable nodes are ones
     * where a peer will not perform routing for us.
     */
    direct: boolean;
    /**
     * Version of routing for this node.
     */
    version: number;
    /**
     * Information about all the peers this is reachable via.
     */
    private reachableVia;
    /**
     * Flag used to help with events when routing is refreshed.
     */
    previousReachable: boolean;
    constructor(parent: Topology, id: ArrayBuffer);
    get hasPeers(): boolean;
    /**
     * Update the routing of this node from an incoming node details.
     *
     * @param peer -
     *   peer these details belong to
     * @param details -
     *   routing details
     * @returns
     *   `true` if details where changed
     */
    updateRouting(peer: Peer, details: NodeRoutingDetails): boolean;
    /**
     * Remove incoming routing from a peer, indicate that the given peer can no
     * longer reach this node.
     *
     * @param peer -
     *   peer
     * @returns
     *   `true` if routing was actually updated
     */
    removeRouting(peer: Peer): boolean;
    /**
     * Turns this node into a routing details object.
     *
     * @returns
     *   details object
     */
    toRoutingDetails(): NodeRoutingDetails;
    /**
     * Update information about what peers we are connected to.
     *
     * @param peers -
     *   peers connected to
     */
    updateSelf(peers: Peer[]): void;
    /**
     * Update the latency we have to our peers.
     *
     * @param peers -
     *   peers connected to
     */
    updateSelfLatencies(peers: Peer[]): void;
    /**
     * Clear all of the outgoing edges.
     */
    protected clearOutgoingEdges(): void;
    /**
     * Add a new outgoing edge.
     *
     * @param cost -
     *   cost to reach the edge,
     * @param target -
     *   node at which the edge points
     */
    protected addOutgoingEdge(cost: number, target: TopologyNode): void;
    /**
     * Get debug information about nodes reachable from this node.
     *
     * @returns
     *   array with identifiers of reachable nodes
     */
    get outgoingDebug(): string[];
    /**
     * Get debug information about which nodes can reach this node.
     *
     * @returns
     *   array with identifies of nodes that can reach this node
     */
    get reachableDebug(): string[];
    /**
     * Get the path used to reach this node from our own network.
     *
     * @returns
     *   array with path used to reach this node
     */
    toPath(): ReadonlyArray<TopologyNode>;
}
//# sourceMappingURL=TopologyNode.d.ts.map