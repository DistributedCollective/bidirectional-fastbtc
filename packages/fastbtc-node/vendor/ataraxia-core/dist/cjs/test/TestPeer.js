"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.peersBetween = void 0;
const ataraxia_transport_1 = require("ataraxia-transport");
/**
 * Peer that simply sends and receives message from another instance. Used to
 * build test setups.
 */
class MirroredPeer extends ataraxia_transport_1.AbstractPeer {
    constructor() {
        super({
            debugNamespace: 'test',
        }, []);
        this.disconnected = false;
    }
    requestDisconnect() {
        super.disconnect();
    }
    connect() {
        this.disconnected = false;
        super.forceConnect(this.id);
    }
    disconnect() {
        if (this.disconnected)
            return;
        this.disconnected = true;
        this.handleDisconnect(ataraxia_transport_1.DisconnectReason.Manual);
    }
    receiveData(type, payload) {
        super.receiveData(type, payload);
    }
    forceConnect(id) {
        super.forceConnect(id);
    }
    send(type, payload) {
        if (!this.connected) {
            return Promise.reject(new Error('Currently disconnected'));
        }
        return new Promise((resolve, reject) => {
            setImmediate(() => {
                if (!this.other) {
                    reject(new Error('Mirror of peer is not set'));
                    return;
                }
                try {
                    this.other.receiveData(type, payload);
                    resolve();
                }
                catch (err) {
                    reject(err);
                }
            });
        });
    }
}
/**
 * Create a pair of peers that are mirrors of each other, the first peer sends
 * to the second pair and vice-versa.
 *
 * @param first -
 *   id of first peer
 * @param second -
 *   if of second peer
 * @returns
 *   array where the first entry represent a connection from the first peer
 *   to the second peer and the second entry represent a connection from the
 *   second peer to the first peer
 */
function peersBetween(first, second) {
    const a = new MirroredPeer();
    const b = new MirroredPeer();
    a.other = b;
    b.other = a;
    a.id = second;
    b.id = first;
    return [a, b];
}
exports.peersBetween = peersBetween;
//# sourceMappingURL=TestPeer.js.map