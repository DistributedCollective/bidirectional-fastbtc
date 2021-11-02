import { Event } from 'atvik';
import { Peer, DataMessage, DataAckMessage, DataRejectMessage } from 'ataraxia-transport';
import { Routing } from './Routing';
/**
 * Messaging on top of the current topology.
 */
export declare class Messaging {
    private readonly debug;
    private readonly pending;
    private readonly routing;
    private readonly dataEvent;
    private idCounter;
    constructor(debugNamespace: string, routing: Routing, dataEvent: Event<any, [ArrayBuffer, string, ArrayBuffer]>);
    private nextId;
    private releaseId;
    private queueTimeout;
    /**
     * Send a message to a specific node.
     *
     * @param target -
     *   identifier of node
     * @param type -
     *   type of message
     * @param data -
     *   encoded data of message
     * @returns
     *   promise that resolves when the node has acknowledged the data, or
     *   rejects if unable to reach the node
     */
    send(target: ArrayBuffer, type: string, data: ArrayBuffer): Promise<void>;
    /**
     * Handle incoming data from a peer.
     *
     * @param peer -
     *   peer sending the data
     * @param data -
     *   the data sent
     */
    handleData(peer: Peer, data: DataMessage): void;
    /**
     * Handle ACK received for a message.
     *
     * @param ack -
     *   details about message that has been acknowledged
     */
    handleAck(ack: DataAckMessage): void;
    /**
     * Handle REJECT received for a message.
     *
     * @param reject -
     *   details about message that has been rejected
     */
    handleReject(reject: DataRejectMessage): void;
}
//# sourceMappingURL=Messaging.d.ts.map