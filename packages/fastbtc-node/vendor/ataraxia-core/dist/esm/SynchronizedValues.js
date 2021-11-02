import { Event } from 'atvik';
import { Debugger } from './Debugger';
/**
 * Shared state between nodes, where each node can set its own value and other
 * nodes will keep track of them.
 *
 * ```javascript
 * const values = new SynchronizedValues(networkOrGroup, 'name-of-value', {
 *   defaultValue: []
 * });
 *
 * state.set([
 *   ...
 * ]);
 * ```
 */
export class SynchronizedValues {
    constructor(group, name, options) {
        var _a, _b;
        this.group = group;
        this.name = name;
        this.debug = new Debugger(this, 'ataraxia:' + group.name + ':state:' + name);
        this.nodes = new Map();
        this.updateEvent = new Event(this);
        if (typeof (options === null || options === void 0 ? void 0 : options.defaultValue) !== 'undefined') {
            this.localVersion = 1;
            this.localValue = options.defaultValue;
        }
        else {
            this.localVersion = 0;
        }
        this.applyPatch = (_a = options === null || options === void 0 ? void 0 : options.applyPatch) !== null && _a !== void 0 ? _a : ((_, patch) => patch);
        this.generatePatch = (_b = options === null || options === void 0 ? void 0 : options.generatePatch) !== null && _b !== void 0 ? _b : (currentValue => currentValue);
        const g = group;
        this.handles = [
            g.onNodeAvailable(this.handleNodeAvailable.bind(this)),
            g.onNodeUnavailable(this.handleNodeUnavailable.bind(this)),
            g.onMessage(this.handleMessage.bind(this))
        ];
        // Track the initial nodes
        for (const node of group.nodes) {
            this.handleNodeAvailable(node);
        }
    }
    /**
     * Destroy this instance. Destroying an instance will stop it from tracking
     * any more state changes.
     */
    destroy() {
        for (const handle of this.handles) {
            handle.unsubscribe();
        }
        for (const nodeState of this.nodes.values()) {
            if (nodeState.expiration) {
                clearTimeout(nodeState.expiration);
            }
        }
    }
    /**
     * Event emitted when the state of a node is updated.
     *
     * @returns
     *   subscribable for event
     */
    get onUpdate() {
        return this.updateEvent.subscribable;
    }
    /**
     * Get the value associated with a node.
     *
     * @param node -
     *   node to get value for
     * @returns
     *   value if present or `undefined`
     */
    get(node) {
        const nodeState = this.nodes.get(node.id);
        if (!nodeState || !nodeState.available)
            return undefined;
        return nodeState.value;
    }
    /**
     * Set the current local value. This will try to synchronize it to other
     * nodes in the current group.
     *
     * @param value -
     *   the local value
     */
    setLocal(value) {
        this.localVersion++;
        this.localValue = value;
        for (const node of this.group.nodes) {
            const nodeState = this.nodes.get(node.id);
            if (!nodeState)
                continue;
            this.sendStatePatch(node, nodeState.knownLocalVersion);
        }
    }
    /**
     * Update the current value.
     *
     * @param func -
     *   function that will receive the current value and version and should
     *   generate the new value
     */
    updateLocal(func) {
        this.setLocal(func(this.localValue, this.localVersion));
    }
    /**
     * Handle a new node becoming available. In this case we ask them about
     * all of their state.
     *
     * @param node -
     *   node that is becoming available
     */
    handleNodeAvailable(node) {
        let nodeState = this.nodes.get(node.id);
        if (!nodeState) {
            // No state for need, initialize
            nodeState = {
                available: true,
                knownLocalVersion: 0,
                version: 0
            };
            this.nodes.set(node.id, nodeState);
        }
        else {
            // Node has become available before it was removed
            if (nodeState.expiration) {
                // Stop the scheduled removal
                clearTimeout(nodeState.expiration);
                nodeState.expiration = undefined;
            }
            nodeState.available = true;
        }
        // Request anything that has changed from the tracked version
        node.send('sync-value:request', {
            name: this.name,
            lastVersion: nodeState.version
        }).catch(err => this.debug.error(err, 'Failed to ask node', node.id, 'about state:'));
    }
    /**
     * Handle a node becoming unavailable. Will emit events about its value not
     * being available and queue it up for removal.
     *
     * @param node -
     *   node that is no longer available
     */
    handleNodeUnavailable(node) {
        const nodeState = this.nodes.get(node.id);
        if (!nodeState)
            return;
        const id = node.id;
        // Mark the state as unavailable
        nodeState.available = false;
        // Queue up a removal of the state in 30 seconds
        nodeState.expiration = setTimeout(() => {
            this.nodes.delete(id);
        }, 30000);
        // Emit that the value is gone
        this.updateEvent.emit(node, undefined);
    }
    handleMessage(message) {
        switch (message.type) {
            case 'sync-value:request':
                {
                    /*
                     * State from a certain version onwards has been requested,
                     * keep track of the version we know they have and send back
                     * a patch with full/new data if we have it.
                     */
                    // Only handle messages intended for us
                    if (message.data.name !== this.name)
                        return;
                    // If no node state we don't handle the message
                    const nodeState = this.nodes.get(message.source.id);
                    if (!nodeState)
                        return;
                    const lastVersion = message.data.lastVersion;
                    if (lastVersion < this.localVersion) {
                        this.sendStatePatch(message.source, lastVersion);
                    }
                    else {
                        this.debug.log(message.source.id, 'requested changes from', lastVersion, 'but no changes made - skipping reply');
                    }
                    break;
                }
            case 'sync-value:patch':
                {
                    /**
                     * Incoming patch of data. Merge it and emit new state.
                     */
                    // Only handle messages intended for us
                    if (message.data.name !== this.name)
                        return;
                    // If no node state we don't handle the message
                    const nodeState = this.nodes.get(message.source.id);
                    if (!nodeState)
                        return;
                    const patch = message.data;
                    if (patch.baseVersion !== nodeState.version) {
                        this.debug.log('Received an update from', message.source.id, 'with version', patch.baseVersion, 'but currently at', nodeState.version, '- patch will be skipped');
                        return;
                    }
                    const value = this.applyPatch(nodeState.value, patch.value);
                    nodeState.value = value;
                    nodeState.version = patch.version;
                    this.updateEvent.emit(message.source, value);
                    message.source.send('sync-value:patch-applied', {
                        name: this.name,
                        version: patch.version,
                    }).catch(err => {
                        this.debug.error(err, 'Failed to acknowledge patch application to', message.source.id);
                    });
                    break;
                }
            case 'sync-value:patch-applied':
                {
                    // Only handle messages intended for us
                    if (message.data.name !== this.name)
                        return;
                    // If no node state we don't handle the message
                    const nodeState = this.nodes.get(message.source.id);
                    if (!nodeState)
                        return;
                    const version = message.data.version;
                    if (nodeState.knownLocalVersion < version) {
                        nodeState.knownLocalVersion = version;
                    }
                    break;
                }
        }
    }
    /**
     * Generate and send a patch to a node.
     *
     * @param node -
     *   node the patch is being sent to
     * @param lastVersion -
     *   the version to generate a patch from
     */
    sendStatePatch(node, lastVersion) {
        this.debug.log('Sending back changes between', lastVersion, 'and', this.localVersion, 'to', node.id);
        if (typeof this.localValue === 'undefined')
            return;
        const patch = this.generatePatch(this.localValue, this.localVersion);
        node.send('sync-value:patch', {
            name: this.name,
            baseVersion: lastVersion,
            version: this.localVersion,
            value: patch
        }).catch(err => {
            // Patch could not be sent, log and emit error
            this.debug.error(err, 'Failed to send patch reply to', node.id);
        });
    }
}
//# sourceMappingURL=SynchronizedValues.js.map