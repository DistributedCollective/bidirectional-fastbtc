import debug from 'debug';
import { Message } from '../Message';
import { Node } from '../Node';
export interface GroupImpl {
    handleNodeAvailable(node: Node): void;
    handleNodeUnavailable(node: Node): void;
    handleMessage(message: Message): void;
}
/**
 * Shared information about an group.
 */
export declare class SharedGroup {
    /**
     * Debugger for log messages.
     */
    readonly debug: debug.Debugger;
    /**
     * Identifier of this group.
     */
    readonly id: string;
    /**
     * Nodes that have joined this group.
     */
    readonly nodes: Map<string, Node>;
    /**
     * All the active instances of this group.
     */
    private readonly instances;
    /**
     * Callback used to tell the parent groups if this group has any
     * active instances.
     */
    private readonly activeCallback;
    constructor(networkName: string, id: string, activeCallback: (active: boolean) => Promise<void>);
    /**
     * Get if this group is currently joined by this node.
     *
     * @returns
     *   `true` if this group is currently joined
     */
    isJoined(): boolean;
    /**
     * Check if a certain node is a member of this group.
     *
     * @param node -
     *   node to check of
     * @returns
     *   `true` if node is a member
     */
    isMember(node: Node): boolean;
    /**
     * Get if this group has any members, local or remote.
     *
     * @returns
     *   `true` if any members present
     */
    hasMembers(): boolean;
    /**
     * Handle that a new node is joining this group.
     *
     * @param node -
     *   node that is joining
     */
    handleNodeJoin(node: Node): void;
    /**
     * Handle that a node may be leaving this group.
     *
     * @param node -
     *   node that is leaving
     */
    handleNodeLeave(node: Node): void;
    /**
     * Handle an incoming message.
     *
     * @param message -
     *   message instance
     */
    handleMessage(message: Message): void;
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
    broadcast(type: string, payload: any): Promise<void>;
    /**
     * Join a local group instance.
     *
     * @param instance -
     *   instance that is joining
     */
    join(instance: GroupImpl): Promise<void>;
    /**
     * Leave this group, sending a message to all current nodes that we
     * are leaving.
     *
     * @param instance -
     *   instance that is leaving
     */
    leave(instance: GroupImpl): Promise<void>;
}
//# sourceMappingURL=SharedGroup.d.ts.map