import { inspect } from 'util';
import { Encoder, Decoder } from '@stablelib/cbor';
import { Event } from 'atvik';
import { debug } from 'debug';
import { encodeId } from 'ataraxia-transport';
/**
 * Node in the network. Thin wrapper around a topology node to provide a
 * simple consistent API suitable for public use.
 */
export class NetworkNode {
    constructor(debugNamespace, topology, id) {
        this.topology = topology;
        this.networkId = id;
        this.id = encodeId(id);
        this.debug = debug(debugNamespace + ':node:' + this.id);
        this.unavailableEvent = new Event(this);
        this.messageEvent = new Event(this);
    }
    get onUnavailable() {
        return this.unavailableEvent.subscribable;
    }
    get onMessage() {
        return this.messageEvent.subscribable;
    }
    get estimatedLatency() {
        var _a, _b;
        return (_b = (_a = this.topology.get(this.networkId)) === null || _a === void 0 ? void 0 : _a.searchCost) !== null && _b !== void 0 ? _b : Number.MAX_SAFE_INTEGER;
    }
    send(type, payload) {
        const encoder = new Encoder();
        encoder.encode(payload);
        const data = encoder.finish();
        this.debug('Sending message type=', type, 'data=', payload);
        return this.topology.sendData(this.networkId, type, data.buffer);
    }
    emitMessage(type, data) {
        const decoder = new Decoder(new Uint8Array(data));
        const payload = decoder.decode();
        const message = {
            source: this,
            type: type,
            data: payload
        };
        this.debug('Received message type=', type, 'data=', payload);
        this.messageEvent.emit(message);
        return message;
    }
    emitUnavailable() {
        this.unavailableEvent.emit();
    }
    [inspect.custom]() {
        return 'Node{' + this.id + '}';
    }
}
//# sourceMappingURL=NetworkNode.js.map