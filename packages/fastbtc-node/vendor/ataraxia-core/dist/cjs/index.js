"use strict";
/* eslint-disable tsdoc/syntax,jsdoc/require-description */
/**
 * Mesh networking with peer-to-peer messaging for NodeJS and the browser.
 * Ataraxia connects different instances together and allows messages to be passed
 * between these instances. Some instances may act as routers for other instances
 * to create a partially connected mesh network.
 *
 * {@link Network} is the main class used to join a network:
 *
 * ```javascript
 * import { Network, AnonymousAuth } from 'ataraxia';
 * import { TCPTransport, TCPPeerMDNSDiscovery } from 'ataraxia-tcp';
 *
 * // Setup a network with a TCP transport
 * const net = new Network({
 *   name: 'name-of-your-app-or-network',
 *   transports: [
 *     new TCPTransport({
 *       // Discover peers using mDNS
 *       discovery: new TCPPeerMDNSDiscovery(),
 *       // Setup anonymous authentication
 *       authentication: [
 *         new AnonymousAuth()
 *       ]
 *     })
 *   ]
 * });
 *
 * net.onNodeAvailable(node => {
 *   console.log('A new node is available', node);
 * });
 *
 * net.onMessage(msg => {
 *   console.log('A new message was received');
 * });
 *
 * // Join the network
 * await net.join();
 * ```
 *
 * Authentication is provided via {@link AnonymousAuth} or
 * {@link SharedSecretAuth}.
 *
 * @module ataraxia
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SharedSecretAuth = exports.AnonymousAuth = void 0;
var ataraxia_transport_1 = require("ataraxia-transport");
Object.defineProperty(exports, "AnonymousAuth", { enumerable: true, get: function () { return ataraxia_transport_1.AnonymousAuth; } });
Object.defineProperty(exports, "SharedSecretAuth", { enumerable: true, get: function () { return ataraxia_transport_1.SharedSecretAuth; } });
__exportStar(require("./Debugger"), exports);
__exportStar(require("./Network"), exports);
__exportStar(require("./Node"), exports);
__exportStar(require("./Message"), exports);
__exportStar(require("./MessageData"), exports);
__exportStar(require("./MessageType"), exports);
__exportStar(require("./MessageUnion"), exports);
__exportStar(require("./Group"), exports);
__exportStar(require("./group/NamedGroup"), exports);
__exportStar(require("./RequestReplyHelper"), exports);
__exportStar(require("./SynchronizedValues"), exports);
//# sourceMappingURL=index.js.map