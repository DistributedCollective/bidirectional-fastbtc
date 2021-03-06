"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Topology = void 0;
const atvik_1 = require("atvik");
const debug_1 = __importDefault(require("debug"));
const ataraxia_transport_1 = require("ataraxia-transport");
const id_1 = require("../id");
const Messaging_1 = require("./Messaging");
const Routing_1 = require("./Routing");
const TopologyNode_1 = require("./TopologyNode");
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
// TODO: Gossip about updated peer latencies
class Topology {
    /**
     * Create a new topology for the given network.
     *
     * @param parent -
     *   network this topology is for
     * @param options -
     *   options to apply
     */
    constructor(parent, options) {
        this.endpoint = options.endpoint || false;
        this.broadcastTimeout = null;
        this.nodes = new id_1.IdMap();
        this.peers = new id_1.IdMap();
        this.availableEvent = new atvik_1.Event(this);
        this.unavailableEvent = new atvik_1.Event(this);
        this.dataEvent = new atvik_1.Event(this);
        this.debug = debug_1.default('ataraxia:' + parent.name + ':topology');
        this.self = new TopologyNode_1.TopologyNode(this, parent.networkIdBinary);
        this.self.direct = true;
        this.nodes.set(parent.networkIdBinary, this.self);
        this.routing = new Routing_1.Routing(this.debug.namespace, this.self, this.nodes, id => {
            const d = this.peers.get(id);
            return d ? d[0].peer : undefined; // TODO: Pick lowest latency
        }, this.availableEvent, this.unavailableEvent);
        this.messaging = new Messaging_1.Messaging(this.debug.namespace, this.routing, this.dataEvent);
    }
    /**
     * Start this topology.
     *
     * @returns
     *   promise that resolves when the topology has been started
     */
    async start() {
        this.latencyGossipHandle = setTimeout(() => {
            this.latencyGossipHandle = setInterval(() => this.gossipLatencies(), 30000);
        }, 2 + (Math.random() * 100));
    }
    /**
     * Stop this topology.
     *
     * @returns
     *   promise that resolves when the topology has stopped
     */
    async stop() {
        clearTimeout(this.latencyGossipHandle);
        clearInterval(this.latencyGossipHandle);
    }
    /**
     * Event emitted when a node becomes available.
     *
     * @returns
     *   `Subscribable` that can be used to add listeners
     */
    get onAvailable() {
        return this.availableEvent.subscribable;
    }
    /**
     * Event emitted when a node becomes unavailable.
     *
     * @returns
     *   `Subscribable` that can be used to add listeners
     */
    get onUnavailable() {
        return this.unavailableEvent.subscribable;
    }
    /**
     * Event emitted when data is received.
     *
     * @returns
     *   `Subscribable` that can be used to add listeners
     */
    get onData() {
        return this.dataEvent.subscribable;
    }
    get(id) {
        return this.nodes.get(id);
    }
    /**
     * Get a specific node, optionally creating it if it is unknown.
     *
     * @param id -
     *   identifier of node
     * @returns
     *   node instance
     */
    getOrCreate(id) {
        let node = this.nodes.get(id);
        if (!node) {
            node = new TopologyNode_1.TopologyNode(this, id);
            this.nodes.set(id, node);
        }
        return node;
    }
    /**
     * Get an iterable containing all the nodes that are known.
     *
     * @returns
     *   iterator with all nodes
     */
    get nodelist() {
        return this.nodes.values();
    }
    /**
     * Add a connected peer to this topology. Will start listening for node
     * information, messages and disconnects. This also starts the discovery
     * process for this node.
     *
     * @param peer -
     *   peer instance
     */
    addPeer(peer) {
        let peers = this.peers.get(peer.id);
        if (!peers) {
            peers = [];
            this.peers.set(peer.id, peers);
        }
        if (this.debug.enabled) {
            this.debug('Peer', ataraxia_transport_1.encodeId(peer.id), 'has connected');
        }
        const peerInfo = {
            peer: peer,
            subscriptions: [
                peer.onData((type, payload) => {
                    switch (type) {
                        case ataraxia_transport_1.PeerMessageType.NodeSummary:
                            this.handleNodeSummaryMessage(peer, payload);
                            break;
                        case ataraxia_transport_1.PeerMessageType.NodeDetails:
                            this.handleNodeDetailsMessage(peer, payload);
                            break;
                        case ataraxia_transport_1.PeerMessageType.NodeRequest:
                            this.handleNodeRequestMessage(peer, payload);
                            break;
                        case ataraxia_transport_1.PeerMessageType.Data:
                            this.messaging.handleData(peer, payload);
                            break;
                        case ataraxia_transport_1.PeerMessageType.DataAck:
                            this.messaging.handleAck(payload);
                            break;
                        case ataraxia_transport_1.PeerMessageType.DataReject:
                            this.messaging.handleReject(payload);
                            break;
                    }
                }),
                peer.onDisconnect(() => {
                    this.handleDisconnect(peer);
                })
            ],
        };
        peers.push(peerInfo);
        // Create or get the node and mark it as reachable
        const node = this.getOrCreate(peer.id);
        node.direct = true;
        // Update our internal routing
        this.self.updateSelf(this.peerArray());
        // Queue a broadcast of routing information
        this.updateRouting(true);
    }
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
    handleNodeSummaryMessage(peer, message) {
        if (this.debug.enabled) {
            this.debug('Incoming NodeSummary from', ataraxia_transport_1.encodeId(peer.id), 'version=', message.ownVersion, ', nodes=', message.nodes.map(n => ataraxia_transport_1.encodeId(n.id) + ' ' + n.version));
        }
        const idsToRequest = [];
        const found = new id_1.IdSet();
        found.add(peer.id);
        const peerNode = this.getOrCreate(peer.id);
        if (peerNode.version < message.ownVersion) {
            // The routing for the peer has updated
            idsToRequest.push(peerNode.id);
        }
        for (const summary of message.nodes) {
            const node = this.getOrCreate(summary.id);
            found.add(summary.id);
            if (node.version < summary.version) {
                // This node is old, request more data for it
                idsToRequest.push(summary.id);
            }
        }
        // Go through all of the nodes and remove this peer from them
        let didChangeRouting = false;
        for (const node of this.nodelist) {
            if (node !== this.self && !found.has(node.id) && !this.peers.get(node.id)) {
                this.debug('Removing from', ataraxia_transport_1.encodeId(node.id));
                if (node.removeRouting(peer)) {
                    didChangeRouting = true;
                }
            }
        }
        if (didChangeRouting) {
            this.updateRouting(true);
        }
        this.debug('Requesting additional info for', idsToRequest.map(ataraxia_transport_1.encodeId));
        if (idsToRequest.length === 0) {
            // All up to date, no need to request anything
            return;
        }
        // Send the request to the peer
        peer.send(ataraxia_transport_1.PeerMessageType.NodeRequest, {
            nodes: idsToRequest
        })
            .catch(err => this.debug('Caught error while sending node request', err));
    }
    /**
     * Handle a request for some node details. Will collect routing details
     * and send them back to the requesting peer.
     *
     * @param peer -
     *   the peer this request is from
     * @param message -
     *   details about the request
     */
    handleNodeRequestMessage(peer, message) {
        const reply = [];
        for (const id of message.nodes) {
            const node = this.nodes.get(id);
            if (!node)
                continue;
            reply.push(node.toRoutingDetails());
        }
        peer.send(ataraxia_transport_1.PeerMessageType.NodeDetails, {
            nodes: reply
        })
            .catch(err => this.debug('Caught error while sending node details', err));
    }
    /**
     * Handle incoming details about some nodes. This will update the local
     * routing and broadcast changes.
     *
     * @param peer -
     *   the peer sending the node details
     * @param message -
     *   details about the routing
     */
    handleNodeDetailsMessage(peer, message) {
        const peerInfo = this.peers.get(peer.id);
        if (!peerInfo)
            return;
        if (this.debug.enabled) {
            this.debug('NodeDetails from', ataraxia_transport_1.encodeId(peer.id));
            for (const node of message.nodes) {
                this.debug(ataraxia_transport_1.encodeId(node.id), 'version=', node.version, 'neighbors=', node.neighbors.map(n => ataraxia_transport_1.encodeId(n.id)));
            }
            this.debug('End NodeDetails');
        }
        let didChangeRouting = false;
        for (const routing of message.nodes) {
            const node = this.getOrCreate(routing.id);
            // Protect against updating our own routing information
            if (node === this.self)
                continue;
            if (node.updateRouting(peer, routing)) {
                didChangeRouting = true;
            }
        }
        // Broadcast routing if changed
        this.updateRouting(didChangeRouting);
    }
    /**
     * Handle that a peer has disconnected. Will update all nodes to indicate
     * that they can not be reached through the peer anymore.
     *
     * @param peer -
     *   the peer being disconnected
     */
    handleDisconnect(peer) {
        const peers = this.peers.get(peer.id);
        if (!peers)
            return;
        if (this.debug.enabled) {
            this.debug('Peer', ataraxia_transport_1.encodeId(peer.id), 'has disconnected');
        }
        const idx = peers.findIndex(peerInfo => peerInfo.peer === peer);
        if (idx < 0)
            return;
        const peerInfo = peers[idx];
        for (const handle of peerInfo.subscriptions) {
            handle.unsubscribe();
        }
        // Remove the peer from the array
        peers.splice(idx, 1);
        if (peers.length === 0) {
            // No more peers with the id, remove direct routing to it
            this.peers.delete(peer.id);
            // Update the node and indicate that it's not directly connectable anymore
            const peerNode = this.getOrCreate(peer.id);
            peerNode.direct = false;
            for (const node of this.nodes.values()) {
                node.removeRouting(peer);
            }
        }
        // Update our internal routing
        this.self.updateSelf(this.peerArray());
        // Broadcast routing as a disconnect changes our version
        this.updateRouting(true);
    }
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
    sendData(target, type, data) {
        return this.messaging.send(target, type, data);
    }
    /**
     * Pick a random peer and send information about current latencies to it.
     */
    gossipLatencies() {
        if (this.peers.size() === 0)
            return;
        // Update the latencies from our own peers
        const peers = this.peerArray();
        this.self.updateSelfLatencies(peers);
        // Pick a peer to send information to
        const peer = peers[Math.floor(Math.random() * peers.length)];
        // Build latency information for all nodes
        const routingDetails = [];
        for (const node of this.nodes.values()) {
            if (node === this.self || ataraxia_transport_1.sameId(node.id, peer.id))
                continue;
            routingDetails.push(node.toRoutingDetails());
        }
        // Only send message if there is anything to send
        if (routingDetails.length === 0) {
            this.debug('Skipped gossiping about latencies');
            return;
        }
        if (this.debug.enabled) {
            this.debug('Gossiping about latencies to', ataraxia_transport_1.encodeId(peer.id));
        }
        // Send the message
        peer.send(ataraxia_transport_1.PeerMessageType.NodeDetails, {
            nodes: routingDetails
        })
            .catch(err => this.debug('Caught error while sending node latencies', err));
    }
    /**
     * Queue that we should broadcast information about our nodes to our
     * peers.
     *
     * @param broadcast -
     *   if the details should be broadcast
     */
    updateRouting(broadcast) {
        // Mark the routing as dirty
        this.routing.markDirty();
        // No need to do anything if broadcasting isn't requested
        if (!broadcast)
            return;
        // Check if there is a pending broadcast
        if (this.broadcastTimeout)
            return;
        this.broadcastTimeout = new Promise(resolve => setTimeout(() => {
            this.routing.refresh();
            if (this.debug.enabled) {
                this.debug('Routing info');
                this.debug('Version:', this.self.version);
                this.debug('Peers:', this.peerArray().map(peer => ataraxia_transport_1.encodeId(peer.id)).join(', '));
                this.debug('Nodes:');
                for (const node of this.nodes.values()) {
                    this.debug(' ', ataraxia_transport_1.encodeId(node.id), 'version=', node.version, 'outgoing=', node.outgoingDebug, 'reachableVia=', node.reachableDebug);
                }
                this.debug('End broadcasting details');
            }
            if (this.endpoint) {
                // Endpoints don't actually broadcast, mark as done
                this.broadcastTimeout = null;
                return;
            }
            const nodes = [];
            for (const node of this.nodes.values()) {
                if (node === this.self)
                    continue;
                if (node.hasPeers) {
                    nodes.push({
                        id: node.id,
                        version: node.version
                    });
                }
            }
            const message = {
                ownVersion: this.self.version,
                nodes: nodes
            };
            for (const peers of this.peers.values()) {
                for (const peerInfo of peers) {
                    peerInfo.peer.send(ataraxia_transport_1.PeerMessageType.NodeSummary, message)
                        .catch(err => this.debug('Caught error while sending node summary', err));
                }
            }
            this.broadcastTimeout = null;
            resolve();
        }, 100));
    }
    peerArray() {
        const result = [];
        for (const peers of this.peers.values()) {
            for (const peerInfo of peers) {
                result.push(peerInfo.peer);
            }
        }
        return result;
    }
    refreshRouting() {
        this.routing.refresh();
    }
    /**
     * Get if any actions are pending for this topology. Used during testing
     * to figure out if its safe to check the results.
     *
     * @returns
     *   `true` if there are actions pending
     */
    get pendingActions() {
        return this.broadcastTimeout !== null;
    }
    /**
     * Get a promise that will resolve when all pending actions have been done.
     */
    async consolidate() {
        await this.broadcastTimeout;
    }
}
exports.Topology = Topology;
//# sourceMappingURL=Topology.js.map