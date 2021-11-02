import debug from 'debug';
/**
 * Shared information about an group.
 */
export class SharedGroup {
    constructor(networkName, id, activeCallback) {
        this.id = id;
        this.activeCallback = activeCallback;
        this.nodes = new Map();
        this.debug = debug('ataraxia:' + networkName + ':group:' + id);
        this.instances = new Set();
    }
    /**
     * Get if this group is currently joined by this node.
     *
     * @returns
     *   `true` if this group is currently joined
     */
    isJoined() {
        return this.instances.size > 0;
    }
    /**
     * Check if a certain node is a member of this group.
     *
     * @param node -
     *   node to check of
     * @returns
     *   `true` if node is a member
     */
    isMember(node) {
        return this.nodes.has(node.id);
    }
    /**
     * Get if this group has any members, local or remote.
     *
     * @returns
     *   `true` if any members present
     */
    hasMembers() {
        return this.nodes.size > 0 || this.instances.size > 0;
    }
    /**
     * Handle that a new node is joining this group.
     *
     * @param node -
     *   node that is joining
     */
    handleNodeJoin(node) {
        // Check that this is actually a new node
        if (this.nodes.has(node.id))
            return;
        this.nodes.set(node.id, node);
        for (const instance of this.instances) {
            instance.handleNodeAvailable(node);
        }
    }
    /**
     * Handle that a node may be leaving this group.
     *
     * @param node -
     *   node that is leaving
     */
    handleNodeLeave(node) {
        if (!this.nodes.has(node.id))
            return;
        this.nodes.delete(node.id);
        for (const instance of this.instances) {
            instance.handleNodeUnavailable(node);
        }
    }
    /**
     * Handle an incoming message.
     *
     * @param message -
     *   message instance
     */
    handleMessage(message) {
        if (!this.nodes.has(message.source.id))
            return;
        for (const instance of this.instances) {
            instance.handleMessage(message);
        }
    }
    /**
     * Broadcast a message to all nodes that have joined this group.
     *
     * @param type -
     *   the type of message to send
     * @param payload -
     *   the payload of the message
     * @returns
     *   promise that resolves when nodes have all been broadcast to
     */
    broadcast(type, payload) {
        const promises = [];
        // Send to all nodes that have joined the group
        for (const node of this.nodes.values()) {
            promises.push(node.send(type, payload)
                .catch(ex => {
                this.debug('Could not broadcast to ' + node.id, ex);
            }));
        }
        return Promise.all(promises)
            .then(() => undefined);
    }
    /**
     * Join a local group instance.
     *
     * @param instance -
     *   instance that is joining
     */
    async join(instance) {
        this.instances.add(instance);
        if (this.instances.size === 1) {
            // First active instance - tell others about us
            await this.activeCallback(true);
        }
    }
    /**
     * Leave this group, sending a message to all current nodes that we
     * are leaving.
     *
     * @param instance -
     *   instance that is leaving
     */
    async leave(instance) {
        this.instances.delete(instance);
        if (this.instances.size === 0) {
            await this.activeCallback(false);
        }
    }
}
//# sourceMappingURL=SharedGroup.js.map