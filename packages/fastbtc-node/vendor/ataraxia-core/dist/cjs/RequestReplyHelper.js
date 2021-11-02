"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RequestReplyHelper = void 0;
/**
 * Helper for managing requests and replies that are identified via a
 * number.
 *
 * ```javascript
 * const helper = new RequestReplyHelper({
 *   timeout: 30000
 * });
 *
 * // Generate an id and get a promise for the request and pass the id somewhere
 * const [ id, promise ] = helper.prepareRequest();
 *
 * // Later on register a reply
 * helper.registerReply(id, replyDataHere);
 *
 * // Or an error if something goes wrong
 * helper.registerError(id, new Error('Things went wrong'));
 * ```
 */
class RequestReplyHelper {
    constructor(options) {
        var _a;
        this.defaultTimeout = (_a = options === null || options === void 0 ? void 0 : options.timeout) !== null && _a !== void 0 ? _a : 30000;
        this.pending = new Map();
        this.idCounter = 0;
    }
    /**
     * Release an identifier.
     *
     * @param id -
     */
    releaseId(id) {
        const pending = this.pending.get(id);
        if (!pending)
            return;
        clearTimeout(pending.timeout);
        this.pending.delete(id);
    }
    /**
     * Prepare a request, will return the identifier to use and a promise that
     * will resolve when the reply is registered.
     *
     * @param options -
     *   options for this request
     * @returns
     *   array with request id and promise. The promise will resolve or reject
     *   when a result or error is registered, or when it times out
     */
    prepareRequest(options) {
        var _a;
        const messageId = this.idCounter++;
        const timeout = (_a = options === null || options === void 0 ? void 0 : options.timeout) !== null && _a !== void 0 ? _a : this.defaultTimeout;
        const promise = new Promise((resolve, reject) => {
            this.pending.set(messageId, {
                resolve: resolve,
                reject: reject,
                timeout: setTimeout(() => this.registerError(messageId, new Error('Timed out')), timeout)
            });
        });
        return [messageId, promise];
    }
    /**
     * Register that a reply has been received for the given identifier. This
     * will resolve the promise associated with the identifier.
     *
     * @param id -
     *   identifier as given previously by `prepareRequest`
     * @param result -
     *   the result to resolve with
     */
    registerReply(id, result) {
        const message = this.pending.get(id);
        if (!message)
            return;
        // Release the message and its identifier
        this.releaseId(id);
        // Resolve the pending message
        message.resolve(result);
    }
    /**
     * Register that an error occurred for the given identifier. This will
     * reject the promise associated with the identifier.
     *
     * @param id -
     *   identifier as given previously by `prepareRequest`
     * @param error -
     *   optional error to reject with
     */
    registerError(id, error) {
        const message = this.pending.get(id);
        if (!message)
            return;
        // Release the message and its identifier
        this.releaseId(id);
        // Resolve the pending message
        message.reject(error);
    }
}
exports.RequestReplyHelper = RequestReplyHelper;
//# sourceMappingURL=RequestReplyHelper.js.map