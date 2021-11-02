"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NetworkNode = void 0;
const util_1 = require("util");
const cbor_1 = require("@stablelib/cbor");
const atvik_1 = require("atvik");
const debug_1 = require("debug");
const ataraxia_transport_1 = require("ataraxia-transport");
/**
 * Node in the network. Thin wrapper around a topology node to provide a
 * simple consistent API suitable for public use.
 */
class NetworkNode {
    constructor(debugNamespace, topology, id) {
        this.topology = topology;
        this.networkId = id;
        this.id = ataraxia_transport_1.encodeId(id);
        this.debug = debug_1.debug(debugNamespace + ':node:' + this.id);
        this.unavailableEvent = new atvik_1.Event(this);
        this.messageEvent = new atvik_1.Event(this);
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
        const encoder = new cbor_1.Encoder();
        encoder.encode(payload);
        const data = encoder.finish();
        this.debug('Sending message type=', type, 'data=', payload);
        return this.topology.sendData(this.networkId, type, data.buffer);
    }
    emitMessage(type, data) {
        const decoder = new cbor_1.Decoder(new Uint8Array(data));
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
    [util_1.inspect.custom]() {
        return 'Node{' + this.id + '}';
    }
}
exports.NetworkNode = NetworkNode;
//# sourceMappingURL=NetworkNode.js.map