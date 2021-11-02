"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TestTransport = void 0;
const ataraxia_transport_1 = require("ataraxia-transport");
/**
 * Transport suitable for use with tests, only support manual adding of peers.
 * Peers usable with this transport can be created via `peersBetween`.
 */
class TestTransport extends ataraxia_transport_1.AbstractTransport {
    constructor() {
        super('test');
    }
    addPeer(peer) {
        super.addPeer(peer);
    }
}
exports.TestTransport = TestTransport;
//# sourceMappingURL=TestTransport.js.map