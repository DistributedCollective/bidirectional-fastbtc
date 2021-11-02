/**
 * Options available for `RequestReplyHelper`.
 */
export interface RequestReplyHelperOptions {
    /**
     * Timeout in millisecond to use for promises, after this time is reached
     * the promise for a request will automatically be rejected.
     *
     * If this property is not set it will default to 30000 ms (30 seconds).
     */
    timeout?: number;
}
/**
 * Options that can be used when preparing a request.
 */
export interface PrepareRequestOptions {
    /**
     * The number of milliseconds to wait before this request is considered
     * to have timed out.
     */
    timeout?: number;
}
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
export declare class RequestReplyHelper<Result> {
    private readonly defaultTimeout;
    private readonly pending;
    private idCounter;
    constructor(options?: RequestReplyHelperOptions);
    /**
     * Release an identifier.
     *
     * @param id -
     */
    private releaseId;
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
    prepareRequest(options?: PrepareRequestOptions): [id: number, result: Promise<Result>];
    /**
     * Register that a reply has been received for the given identifier. This
     * will resolve the promise associated with the identifier.
     *
     * @param id -
     *   identifier as given previously by `prepareRequest`
     * @param result -
     *   the result to resolve with
     */
    registerReply(id: number, result: Result): void;
    /**
     * Register that an error occurred for the given identifier. This will
     * reject the promise associated with the identifier.
     *
     * @param id -
     *   identifier as given previously by `prepareRequest`
     * @param error -
     *   optional error to reject with
     */
    registerError(id: number, error?: Error): void;
}
//# sourceMappingURL=RequestReplyHelper.d.ts.map