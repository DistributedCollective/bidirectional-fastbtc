"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NamedGroup = void 0;
const atvik_1 = require("atvik");
const GroupManager_1 = require("./GroupManager");
/**
 * Group with a specific name, lets nodes in the network join and leave as
 * needed.
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
 */
class NamedGroup {
    constructor(net, name) {
        const manager = net.getService(GroupManager_1.GroupManager);
        this.initializer = manager.getSharedGroup(name);
        this.name = net.name + ':' + name;
        this.nodeAvailableEvent = new atvik_1.Event(this);
        this.nodeUnavailableEvent = new atvik_1.Event(this);
        this.messageEvent = new atvik_1.Event(this);
        this.handler = {
            handleNodeAvailable: this.nodeAvailableEvent.emit.bind(this.nodeAvailableEvent),
            handleNodeUnavailable: this.nodeUnavailableEvent.emit.bind(this.nodeUnavailableEvent),
            handleMessage: this.messageEvent.emit.bind(this.messageEvent)
        };
    }
    get onNodeAvailable() {
        return this.nodeAvailableEvent.subscribable;
    }
    get onNodeUnavailable() {
        return this.nodeUnavailableEvent.subscribable;
    }
    get onMessage() {
        return this.messageEvent.subscribable;
    }
    get nodes() {
        return [...this.initializer().nodes.values()];
    }
    broadcast(type, payload) {
        var _a, _b;
        return (_b = (_a = this.shared) === null || _a === void 0 ? void 0 : _a.broadcast(type, payload)) !== null && _b !== void 0 ? _b : Promise.resolve();
    }
    join() {
        if (this.shared)
            return Promise.resolve();
        this.shared = this.initializer();
        return this.shared.join(this.handler);
    }
    leave() {
        if (!this.shared)
            return Promise.resolve();
        const shared = this.shared;
        this.shared = undefined;
        return shared.leave(this.handler);
    }
}
exports.NamedGroup = NamedGroup;
//# sourceMappingURL=NamedGroup.js.map