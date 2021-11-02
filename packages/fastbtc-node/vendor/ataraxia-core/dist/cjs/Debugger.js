"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Debugger = void 0;
const atvik_1 = require("atvik");
const debug_1 = __importDefault(require("debug"));
/**
 * Helper for creating a good debug experience for Ataraxia classes. Builds
 * on top of [debug](https://github.com/visionmedia/debug) but adds support
 * for emitting errors as events.
 */
class Debugger {
    /**
     * Create a new instance.
     *
     * @param parent -
     *   object to use as this for emitted error events
     * @param namespace -
     *   the namespace to use for the debug logging
     */
    constructor(parent, namespace) {
        this.debug = debug_1.default(namespace);
        this.errorEvent = new atvik_1.Event(parent);
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
exports.Debugger = Debugger;
//# sourceMappingURL=Debugger.js.map