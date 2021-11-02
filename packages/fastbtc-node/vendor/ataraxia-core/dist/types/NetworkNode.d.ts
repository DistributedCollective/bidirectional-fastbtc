/// <reference types="debug" />
/// <reference types="node" />
import { inspect } from 'util';
import { Message } from './Message';
import { Node } from './Node';
import { Topology } from './topology';
/**
 * Node in the network. Thin wrapper around a topology node to provide a
 * simple consistent API suitable for public use.
 */
export declare class NetworkNode implements Node {
    protected readonly debug: debug.Debugger;
    private readonly topology;
    private readonly networkId;
    readonly id: string;
    private readonly unavailableEvent;
    private readonly messageEvent;
    constructor(debugNamespace: string, topology: Topology, id: ArrayBuffer);
    get onUnavailable(): import("atvik").Subscribable<this, []>;
    get onMessage(): import("atvik").Subscribable<this, [Message<any, string>]>;
    get estimatedLatency(): number;
    send(type: string, payload: any): Promise<void>;
    emitMessage(type: string, data: ArrayBuffer): Message;
    emitUnavailable(): void;
    [inspect.custom](): string;
}
//# sourceMappingURL=NetworkNode.d.ts.map