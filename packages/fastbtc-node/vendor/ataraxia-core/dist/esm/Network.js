var __classPrivateFieldSet = (this && this.__classPrivateFieldSet) || function (receiver, state, value, kind, f) {
    if (kind === "m") throw new TypeError("Private method is not writable");
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return (kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value)), value;
};
var __classPrivateFieldGet = (this && this.__classPrivateFieldGet) || function (receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var _Network_transports, _Network_active, _Network_topology, _Network_nodes, _Network_nodeAvailableEvent, _Network_nodeUnavailableEvent, _Network_messageEvent;
import { Event } from 'atvik';
import { generateId, encodeId } from 'ataraxia-transport';
import { Debugger } from './Debugger';
import { NetworkNode } from './NetworkNode';
import { Topology } from './topology';
/**
 * Network of nodes. The network is the main class in Ataraxia and uses one or
 * more transports to connect to peers and discover nodes in the network.
 *
 * Networks are required to have a name which represents a short name that
 * describes the network. Transports can use this name to automatically find
 * peers with the same network name.
 *
 * Networks can be joined and left as needed. The same app is encouraged to
 * only join the network once and then share an instance of `Network` as
 * needed.
 *
 * ```javascript
 * const net = new Network({
 *   name: 'name-of-network',
 *
 *   transports: [
 *      new MachineLocalNetwork()
 *   ]
 * });
 *
 * await net.join();
 * ```
 *
 * ## Nodes of the network
 *
 * When a network is joined this instance will start emitting events about
 * what nodes are available on the network. It is recommended to use
 * {@link onNodeAvailable} and {@link onNodeUnavailable} to keep track of what
 * nodes the instance can communicate with.
 *
 * It's possible to iterate over a snapshot of nodes using {@link nodes}.
 *
 * ## Sending and receiving messages
 *
 * Messaging in Ataraxia does not guarantee delivery, messages may or may not
 * reach their intended targets.
 *
 * The {@link onMessage} event can be used to listen to events from any node,
 * which is recommended to do when building something that deals with many
 * nodes. If you're only interested in messages from a single node,
 * {@link Node.onMessage} can be used instead.
 *
 * To send a message to a single node use {@link Node.send}.
 *
 * It is possible to broadcast a message to all the known nodes via
 * {@link broadcast}, but as with regular messages no delivery is guaranteed
 * and large broadcasts are discouraged.
 *
 * ## Groups
 *
 * Groups are a way to create named area of the network that nodes can
 * join and leave as needed. Broadcasting a message on an group will only
 * send it to known members of the groups.
 *
 * ```typescript
 * const group = new NamedGroup(net, 'name-of-group');
 *
 * // Groups need to be joined
 * await group.join();
 *
 * // Broadcast to the known members
 * await group.broadcast('typeOfMessage', dataOfMessage);
 * ```
 *
 * ## Typing of messages
 *
 * The network and groups can be typed when using TypeScript.
 *
 * The types are defined as an interface with the keys representing the
 * message types tied to the type of message:
 *
 * ```typescript
 * interface EchoMessages {
 *   'namespace:echo': { message: string };
 *   'namespace:echo-reply': { reply: string };
 * }
 * ```
 *
 * An group can then be typed via:
 *
 * ```typescript
 * const group: Group<EchoMessages> = new NamedGroup<EchoMessage>(net, 'echo');
 * ```
 *
 * This will help TypeScript validate messages that are sent:
 *
 * ```typescript
 * // TypeScript will allow this
 * group.broadcast('namespace:echo', { message: 'Test' });
 *
 * // TypeScript will not allow these
 * group.broadcast('namespace:echo', { msg: 'Test' });
 * group.broadcast('namespace:e', { message: 'Test' });
 * ```
 *
 * The same is true for listeners:
 *
 * ```typescript
 * group.onMessage(msg => {
 *   if(msg.type === 'namespace:echo') {
 *      // In here msg.data will be of the type { message: string }
 *      const data = msg.data;
 *      msg.source.send('namespace:echo-reply', { reply: data.message })
 *        .catch(errorHandler);
 *   } else if(msg.type === 'namespace:echo-reply') {
 *     // msg.data will be { reply: string }
 *   } else {
 *      // No message of this type
 *   }
 * });
 * ```
 */
export class Network {
    /**
     * Create a new network. A network must be provided a `name` which is a
     * short string used that transports may use to discover peers. Such a
     * short name is usually something like `app-name` or `known-network-name`.
     *
     * These options are available:
     *
     * * `name` - the name of the network
     * * `endpoint` - boolean indicating if this instance is an endpoint and
     *    wants to avoid routing.
     * * `transports` - array of transports that the network should start
     *
     * @param options -
     *   The options of the network.
     */
    constructor(options) {
        var _a;
        /**
         * The transports for the network.
         */
        _Network_transports.set(this, void 0);
        /**
         * If the network is currently active.
         */
        _Network_active.set(this, void 0);
        /**
         * The topology of the network.
         */
        _Network_topology.set(this, void 0);
        /**
         * The nodes of the network.
         */
        _Network_nodes.set(this, void 0);
        _Network_nodeAvailableEvent.set(this, void 0);
        _Network_nodeUnavailableEvent.set(this, void 0);
        _Network_messageEvent.set(this, void 0);
        if (!options) {
            throw new Error('Options must be provided');
        }
        if (!options.name) {
            throw new Error('Name of network is required');
        }
        const debugNamespace = 'ataraxia:' + options.name;
        this.debug = new Debugger(this, debugNamespace);
        this.networkIdBinary = generateId();
        this.name = options.name;
        this.endpoint = options.endpoint || false;
        __classPrivateFieldSet(this, _Network_transports, [], "f");
        __classPrivateFieldSet(this, _Network_active, false, "f");
        __classPrivateFieldSet(this, _Network_nodeAvailableEvent, new Event(this), "f");
        __classPrivateFieldSet(this, _Network_nodeUnavailableEvent, new Event(this), "f");
        __classPrivateFieldSet(this, _Network_messageEvent, new Event(this), "f");
        __classPrivateFieldSet(this, _Network_nodes, new Map(), "f");
        this.services = new Map();
        // Setup the topology of the network
        __classPrivateFieldSet(this, _Network_topology, new Topology(this, options), "f");
        __classPrivateFieldGet(this, _Network_topology, "f").onAvailable(n => {
            const node = new NetworkNode(debugNamespace, __classPrivateFieldGet(this, _Network_topology, "f"), n.id);
            __classPrivateFieldGet(this, _Network_nodes, "f").set(node.id, node);
            __classPrivateFieldGet(this, _Network_nodeAvailableEvent, "f").emit(node);
        });
        __classPrivateFieldGet(this, _Network_topology, "f").onUnavailable(n => {
            const encodedId = encodeId(n.id);
            const node = __classPrivateFieldGet(this, _Network_nodes, "f").get(encodedId);
            if (!node)
                return;
            __classPrivateFieldGet(this, _Network_nodes, "f").delete(encodedId);
            node.emitUnavailable();
            __classPrivateFieldGet(this, _Network_nodeUnavailableEvent, "f").emit(node);
        });
        __classPrivateFieldGet(this, _Network_topology, "f").onData((id, type, data) => {
            const encodedId = encodeId(id);
            const node = __classPrivateFieldGet(this, _Network_nodes, "f").get(encodedId);
            if (!node)
                return;
            const msg = node.emitMessage(type, data);
            __classPrivateFieldGet(this, _Network_messageEvent, "f").emit(msg);
        });
        // Add all the transports if given via options
        (_a = options.transports) === null || _a === void 0 ? void 0 : _a.forEach(t => this.addTransport(t));
    }
    /**
     * Get a service as a singleton. This is useful for starting a single
     * instance of shared services.
     *
     * @param factory -
     *   constructor that takes instance of network
     * @returns
     *   instance of factory
     */
    getService(factory) {
        let instance = this.services.get(factory);
        if (instance)
            return instance;
        instance = new factory(this);
        this.services.set(factory, instance);
        return instance;
    }
    /**
     * Event emitted when a {@link Node} becomes available.
     *
     * @returns
     *   subscribable function
     */
    get onNodeAvailable() {
        return __classPrivateFieldGet(this, _Network_nodeAvailableEvent, "f").subscribable;
    }
    /**
     * Event emitted when a {@link Node} becomes unavailable.
     *
     * @returns
     *   subscribable function
     */
    get onNodeUnavailable() {
        return __classPrivateFieldGet(this, _Network_nodeUnavailableEvent, "f").subscribable;
    }
    /**
     * Event emitted when a message is received from any node on the network.
     *
     * @returns
     *   subscribable function
     */
    get onMessage() {
        return __classPrivateFieldGet(this, _Network_messageEvent, "f").subscribable;
    }
    /**
     * The identifier this local node has, this is the name other nodes see
     * us as.
     *
     * @returns
     *   network identifier as string
     */
    get networkId() {
        return encodeId(this.networkIdBinary);
    }
    /**
     * Get a snapshot of nodes that can be currently seen in the network.
     *
     * @returns
     *   array of nodes
     */
    get nodes() {
        return [...__classPrivateFieldGet(this, _Network_nodes, "f").values()];
    }
    /**
     * Add a transport to this network. If the network is started the transport
     * will also be started.
     *
     * @param transport -
     *   instance of transport to add
     */
    addTransport(transport) {
        if (__classPrivateFieldGet(this, _Network_transports, "f").indexOf(transport) >= 0) {
            return;
        }
        __classPrivateFieldGet(this, _Network_transports, "f").push(transport);
        // Whenever a peer is connected send it to the topology
        transport.onPeerConnect(peer => __classPrivateFieldGet(this, _Network_topology, "f").addPeer(peer));
        if (__classPrivateFieldGet(this, _Network_active, "f")) {
            transport.start({
                networkId: this.networkIdBinary,
                networkName: this.name,
                endpoint: this.endpoint,
                debugNamespace: this.debug.namespace
            })
                .catch(ex => {
                this.debug.error(ex, 'Could not start transport:');
            });
        }
    }
    /**
     * Join the network by starting a server and then looking for peers.
     *
     * @returns
     *   promise that resolves when the network is started, the value will
     *   represent if the network was actually started or not.
     */
    async join() {
        if (__classPrivateFieldGet(this, _Network_active, "f"))
            return;
        this.debug.log('About to join network as ' + this.networkId);
        const options = {
            networkId: this.networkIdBinary,
            networkName: this.name,
            endpoint: this.endpoint,
            debugNamespace: this.debug.namespace
        };
        __classPrivateFieldSet(this, _Network_active, true, "f");
        // Start the topology
        await __classPrivateFieldGet(this, _Network_topology, "f").start();
        // Start all the transports
        try {
            await Promise.all(__classPrivateFieldGet(this, _Network_transports, "f").map(t => t.start(options)));
        }
        catch (err) {
            // Stop the topology if an error occurs
            await __classPrivateFieldGet(this, _Network_topology, "f").stop();
            __classPrivateFieldSet(this, _Network_active, false, "f");
            throw err;
        }
    }
    /**
     * Leave the currently joined network.
     *
     * @returns
     *   promise that resolves when the network is stopped
     */
    async leave() {
        if (!__classPrivateFieldGet(this, _Network_active, "f"))
            return;
        // Stop the topology
        await __classPrivateFieldGet(this, _Network_topology, "f").stop();
        // Stop all the transports
        await Promise.all(__classPrivateFieldGet(this, _Network_transports, "f").map(t => t.stop()));
        __classPrivateFieldSet(this, _Network_active, false, "f");
    }
    /**
     * Broadcast a message to all nodes.
     *
     * @param type -
     *   the type of message to send
     * @param data -
     *   the data of the message
     * @returns
     *   promise that resolves when the message has been broadcast to all known
     *   nodes
     */
    broadcast(type, data) {
        const promises = [];
        // Send to all nodes that have joined the group
        for (const node of __classPrivateFieldGet(this, _Network_nodes, "f").values()) {
            promises.push(node.send(type, data)
                .catch(ex => {
                this.debug.error(ex, 'Could not broadcast to ' + node.id + ':');
            }));
        }
        return Promise.all(promises)
            .then(() => undefined);
    }
}
_Network_transports = new WeakMap(), _Network_active = new WeakMap(), _Network_topology = new WeakMap(), _Network_nodes = new WeakMap(), _Network_nodeAvailableEvent = new WeakMap(), _Network_nodeUnavailableEvent = new WeakMap(), _Network_messageEvent = new WeakMap();
//# sourceMappingURL=Network.js.map