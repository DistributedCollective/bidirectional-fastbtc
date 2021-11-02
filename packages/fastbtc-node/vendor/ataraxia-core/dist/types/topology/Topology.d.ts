import { Peer } from 'ataraxia-transport';
import { Network } from '../Network';
import { TopologyNode } from './TopologyNode';
/**
 * Options for a topology instance.
 */
export interface TopologyOptions {
    /**
     * If the current node should be considered an endpoint. Endpoints do not
     * perform routing.
     */
    endpoint?: boolean;
}
/**
 * Information about the topology of the network.
 *
 * This class is responsible for managing the routing within the partially
 * connected mesh network. The routing uses ideas from Shortest Path Bridging,
 * in that it picks the route that it believes to be the shortest one.
 *
 * It does this by creating a graph of the nodes using information the
 * connected peers. To find where to a send a message the graph is then queried
 * about the shortest path between this node and the target node.
 */
export declare class Topology {
    private readonly debug;
    private readonly endpoint;
    private readonly availableEvent;
    private readonly unavailableEvent;
    private readonly dataEvent;
    private readonly self;
    private readonly nodes;
    private readonly peers;
    private readonly routing;
    private readonly messaging;
    private latencyGossipHandle;
    /**
     * Timeout handle if a broadcast is currently queued.
     */
    private broadcastTimeout;
    /**
     * Create a new topology for the given network.
     *
     * @param parent -
     *   network this topology is for
     * @param options -
     *   options to apply
     */
    constructor(parent: Pick<Network, 'name' | 'networkIdBinary'>, options: TopologyOptions);
    /**
     * Start this topology.
     *
     * @returns
     *   promise that resolves when the topology has been started
     */
    start(): Promise<void>;
    /**
     * Stop this topology.
     *
     * @returns
     *   promise that resolves when the topology has stopped
     */
    stop(): Promise<void>;
    /**
     * Event emitted when a node becomes available.
     *
     * @returns
     *   `Subscribable` that can be used to add listeners
     */
    get onAvailable(): import("atvik").Subscribable<this, [node: TopologyNode]>;
    /**
     * Event emitted when a node becomes unavailable.
     *
     * @returns
     *   `Subscribable` that can be used to add listeners
     */
    get onUnavailable(): import("atvik").Subscribable<this, [node: TopologyNode]>;
    /**
     * Event emitted when data is received.
     *
     * @returns
     *   `Subscribable` that can be used to add listeners
     */
    get onData(): import("atvik").Subscribable<this, [node: ArrayBuffer, type: string, payload: ArrayBuffer]>;
    get(id: ArrayBuffer): TopologyNode | undefined;
    /**
     * Get a specific node, optionally creating it if it is unknown.
     *
     * @param id -
     *   identifier of node
     * @returns
     *   node instance
     */
    getOrCreate(id: ArrayBuffer): TopologyNode;
    /**
     * Get an iterable containing all the nodes that are known.
     *
     * @returns
     *   iterator with all nodes
     */
    get nodelist(): IterableIterator<TopologyNode>;
    /**
     * Add a connected peer to this topology. Will start listening for node
     * information, messages and disconnects. This also starts the discovery
     * process for this node.
     *
     * @param peer -
     *   peer instance
     */
    addPeer(peer: Peer): void;
    /**
     * Handle a summary message from another peer. This will look through
     * and compare our current node data and send requests for anything where
     * our version is too low.
     *
     * @param peer -
     *   peer this message is from
     * @param message -
     *   message with node summary
     */
    private handleNodeSummaryMessage;
    /**
     * Handle a request for some node details. Will collect routing details
     * and send them back to the requesting peer.
     *
     * @param peer -
     *   the peer this request is from
     * @param message -
     *   details about the request
     */
    private handleNodeRequestMessage;
    /**
     * Handle incoming details about some nodes. This will update the local
     * routing and broadcast changes.
     *
     * @param peer -
     *   the peer sending the node details
     * @param message -
     *   details about the routing
     */
    private handleNodeDetailsMessage;
    /**
     * Handle that a peer has disconnected. Will update all nodes to indicate
     * that they can not be reached through the peer anymore.
     *
     * @param peer -
     *   the peer being disconnected
     */
    private handleDisconnect;
    /**
     * Send data to a given node.
     *
     * @param target -
     *   node to send data to
     * @param type -
     *   type of data being sent
     * @param data -
     *   buffer with data to send
     * @returns
     *   promise that resolves when the message has been acknowledges by the
     *   target node
     */
    sendData(target: ArrayBuffer, type: string, data: ArrayBuffer): Promise<void>;
    /**
     * Pick a random peer and send information about current latencies to it.
     */
    private gossipLatencies;
    /**
     * Queue that we should broadcast information about our nodes to our
     * peers.
     *
     * @param broadcast -
     *   if the details should be broadcast
     */
    private updateRouting;
    private peerArray;
    refreshRouting(): void;
    /**
     * Get if any actions are pending for this topology. Used during testing
     * to figure out if its safe to check the results.
     *
     * @returns
     *   `true` if there are actions pending
     */
    get pendingActions(): boolean;
    /**
     * Get a promise that will resolve when all pending actions have been done.
     */
    consolidate(): Promise<void>;
}
//# sourceMappingURL=Topology.d.ts.map