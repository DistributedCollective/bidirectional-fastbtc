import { Group } from '../Group';
import { MessageData } from '../MessageData';
import { MessageType } from '../MessageType';
import { MessageUnion } from '../MessageUnion';
import { Network } from '../Network';
import { Node } from '../Node';
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
export declare class NamedGroup<MessageTypes extends object> implements Group<MessageTypes> {
    /**
     * Initializer used to fetch an group.
     */
    private readonly initializer;
    /**
     * The current shared instance.
     */
    private shared?;
    /**
     * Get the name of this group in the network. Will be prefixed with the
     * network name.
     */
    readonly name: string;
    /**
     * Event emitted whenever a node joins this group.
     */
    private readonly nodeAvailableEvent;
    /**
     * Event emitted whenever a node leaves this group.
     */
    private readonly nodeUnavailableEvent;
    /**
     * Event emitted whenever a message is received for this group.
     */
    private readonly messageEvent;
    private readonly handler;
    constructor(net: Network, name: string);
    get onNodeAvailable(): import("atvik").Subscribable<this, [node: Node<MessageTypes>]>;
    get onNodeUnavailable(): import("atvik").Subscribable<this, [node: Node<MessageTypes>]>;
    get onMessage(): import("atvik").Subscribable<this, [message: MessageUnion<MessageTypes>]>;
    get nodes(): Node[];
    broadcast<T extends MessageType<MessageTypes>>(type: T, payload: MessageData<MessageTypes, T>): Promise<void>;
    join(): Promise<void>;
    leave(): Promise<void>;
}
//# sourceMappingURL=NamedGroup.d.ts.map