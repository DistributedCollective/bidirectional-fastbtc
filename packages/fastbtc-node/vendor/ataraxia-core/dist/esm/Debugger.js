import { Event } from 'atvik';
import debug from 'debug';
/**
 * Helper for creating a good debug experience for Ataraxia classes. Builds
 * on top of [debug](https://github.com/visionmedia/debug) but adds support
 * for emitting errors as events.
 */
export class Debugger {
    /**
     * Create a new instance.
     *
     * @param parent -
     *   object to use as this for emitted error events
     * @param namespace -
     *   the namespace to use for the debug logging
     */
    constructor(parent, namespace) {
        this.debug = debug(namespace);
        this.errorEvent = new Event(parent);
    }
    /**
     * Get if the debugger prints messages.
     *
     * @returns
     *   `true` if messages are printed
     */
    get enabled() {
        return this.debug.enabled;
    }
    /**
     * The current namespace.
     *
     * @returns
     *   namespace used to print messages
     */
    get namespace() {
        return this.debug.namespace;
    }
    /**
     * Event emitted when an error occurs.
     *
     * @returns
     *   subscribable
     */
    get onError() {
        return this.errorEvent.subscribable;
    }
    /**
     * Log something.
     *
     * @param formatter -
     *   formatter
     * @param args -
     *   arguments
     */
    log(formatter, ...args) {
        this.debug(formatter, ...args);
    }
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
    error(error, formatter = 'An error has occurred:', ...args) {
        this.debug(formatter, ...args, error);
        this.errorEvent.emit(error);
    }
}
//# sourceMappingURL=Debugger.js.map