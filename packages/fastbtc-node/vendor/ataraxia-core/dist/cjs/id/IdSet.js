"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IdSet = void 0;
const ataraxia_transport_1 = require("ataraxia-transport");
/**
 * Set for keeping track of identifiers.
 */
class IdSet {
    constructor(values) {
        this.data = new Map();
        if (values) {
            for (const v of values) {
                this.add(v);
            }
        }
    }
    /**
     * Add an identifier to this set.
     *
     * @param id -
     *   buffer with id
     */
    add(id) {
        this.data.set(ataraxia_transport_1.encodeId(id), id);
    }
    /**
     * Check if a given identifier is in the set.
     *
     * @param id -
     *   buffer with id
     * @returns
     *   `true` if id exists in set
     */
    has(id) {
        return this.data.has(ataraxia_transport_1.encodeId(id));
    }
    /**
     * Delete an identifier from the set.
     *
     * @param id -
     *   buffer with id
     */
    delete(id) {
        this.data.delete(ataraxia_transport_1.encodeId(id));
    }
    /**
     * Get the number of identifiers in this set.
     *
     * @returns
     *   size
     */
    get size() {
        return this.data.size;
    }
    /**
     * Get all the identifiers in this set.
     *
     * @returns
     *   iterator with values
     */
    values() {
        return this.data.values();
    }
}
exports.IdSet = IdSet;
//# sourceMappingURL=IdSet.js.map