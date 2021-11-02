import { FibonacciHeap } from '@tyriar/fibonacci-heap';
import debugFactory from 'debug';
import { encodeId } from 'ataraxia-transport';
/**
 * Abstraction to help with finding the best route for a packet.
 */
export class Routing {
    constructor(debugNamespace, self, nodes, peers, availableEvent, unavailableEvent) {
        this.debug = debugFactory(debugNamespace + ':routing');
        this.self = self;
        this.nodes = nodes;
        this.peers = peers;
        this.availableEvent = availableEvent;
        this.unavailableEvent = unavailableEvent;
        this.dirty = true;
    }
    /**
     * Get a peer based on its identifier.
     *
     * @param id -
     *   id of peer
     * @returns
     *   `Peer` if available
     */
    getPeer(id) {
        return this.peers(id);
    }
    /**
     * Mark the routing as dirty to allow it to recalculate the paths.
     */
    markDirty() {
        this.dirty = true;
    }
    /**
     * Refreshing the routing if it is dirty. This will calculate the best
     * way to reach all nodes and emit events for node availability.
     */
    refresh() {
        if (!this.dirty)
            return;
        this.calculatePaths();
        this.dirty = false;
        for (const node of Array.from(this.nodes.values())) {
            const available = !!node.peer || node === this.self;
            if (available) {
                if (!node.previousReachable) {
                    node.previousReachable = true;
                    if (node !== this.self) {
                        // Protect against self as a node
                        this.availableEvent.emit(node);
                    }
                }
            }
            else {
                if (this.debug.enabled) {
                    this.debug('Not available', encodeId(node.id));
                }
                node.previousReachable = false;
                this.unavailableEvent.emit(node);
                // TODO: Longer delay before removing node?
                this.nodes.delete(node.id);
            }
        }
    }
    /**
     * Find the peer used to reach the given node.
     *
     * @param node -
     *   identifier of node
     * @returns
     *   `Peer` if a path is available
     */
    findPeerForTarget(node) {
        var _a;
        // Perform a refresh if needed
        this.refresh();
        const n = this.nodes.get(node);
        return (_a = n === null || n === void 0 ? void 0 : n.peer) !== null && _a !== void 0 ? _a : null;
    }
    /**
     * Perform a recalculation of the best paths to take to all nodes. This
     * runs Dijkstra's algorithm to calculate the shortest paths to all nodes.
     */
    calculatePaths() {
        const heap = new FibonacciHeap();
        for (const node of this.nodes.values()) {
            if (this.self === node) {
                node.searchCost = 0;
            }
            else {
                node.searchCost = Number.MAX_SAFE_INTEGER;
            }
            node.searchPrevious = undefined;
            node.searchNode = heap.insert(node.searchCost, node);
        }
        while (!heap.isEmpty()) {
            const v = heap.extractMinimum();
            if (!v || !v.value)
                throw new Error('Heap returned isEmpty()=false but did not return node');
            const node = v.value;
            for (const edge of node.outgoing) {
                const cost = node.searchCost + edge.cost;
                if (cost < edge.target.searchCost) {
                    edge.target.searchCost = cost;
                    edge.target.searchPrevious = node;
                    if (!edge.target.searchNode) {
                        throw new Error('Node not inserted into heap');
                    }
                    heap.decreaseKey(edge.target.searchNode, cost);
                }
            }
        }
        const debug = this.debug.enabled;
        for (const node of this.nodes.values()) {
            node.searchNode = undefined;
            if (node.direct) {
                // Directly reachable, get its peer
                node.peer = this.peers(node.id);
                if (debug) {
                    this.debug(encodeId(node.id), 'directly reachable');
                }
                continue;
            }
            else if (!node.searchPrevious) {
                // This node isn't reachable
                node.peer = undefined;
                node.version = 0;
                if (debug) {
                    this.debug(encodeId(node.id), 'not reachable');
                }
                continue;
            }
            let previous = node.searchPrevious;
            while (previous && !previous.direct) {
                previous = previous.searchPrevious;
            }
            if (previous && previous.direct) {
                node.peer = this.peers(previous.id);
                if (debug) {
                    this.debug(encodeId(node.id), 'reachable via peer', encodeId(previous.id));
                }
            }
            else {
                node.peer = undefined;
                node.version = 0;
                if (debug) {
                    this.debug(encodeId(node.id), 'not reachable');
                }
            }
        }
    }
}
//# sourceMappingURL=Routing.js.map