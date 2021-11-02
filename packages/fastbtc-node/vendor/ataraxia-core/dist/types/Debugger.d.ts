/**
 * Helper for creating a good debug experience for Ataraxia classes. Builds
 * on top of [debug](https://github.com/visionmedia/debug) but adds support
 * for emitting errors as events.
 */
export declare class Debugger<T extends object> {
    /**
     * Debug instance used for logging.
     */
    private readonly debug;
    /**
     * Event used for errors.
     */
    private readonly errorEvent;
    /**
     * Create a new instance.
     *
     * @param parent -
     *   object to use as this for emitted error events
     * @param namespace -
     *   the namespace to use for the debug logging
     */
    constructor(parent: T, namespace: string);
    /**
     * Get if the debugger prints messages.
     *
     * @returns
     *   `true` if messages are printed
     */
    get enabled(): boolean;
    /**
     * The current namespace.
     *
     * @returns
     *   namespace used to print messages
     */
    get namespace(): string;
    /**
     * Event emitted when an error occurs.
     *
     * @returns
     *   subscribable
     */
    get onError(): import("atvik").Subscribable<T, [error: Error]>;
    /**
     * Log something.
     *
     * @param formatter -
     *   formatter
     * @param args -
     *   arguments
     */
    log(formatter: any, ...args: any[]): void;
    /**
     * Log and emit an error.
     *
     * @param error -
     *   error that occurred
     * @param formatter -
     *   formatter
     * @param args -
     *   arguments
     */
    error(error: Error, formatter?: any, ...args: any[]): void;
}
//# sourceMappingURL=Debugger.d.ts.map