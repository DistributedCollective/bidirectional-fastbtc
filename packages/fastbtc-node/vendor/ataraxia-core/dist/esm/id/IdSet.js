import { encodeId } from 'ataraxia-transport';
/**
 * Set for keeping track of identifiers.
 */
export class IdSet {
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
        this.data.set(encodeId(id), id);
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
        return this.data.has(encodeId(id));
    }
    /**
     * Delete an identifier from the set.
     *
     * @param id -
     *   buffer with id
     */
    delete(id) {
        this.data.delete(encodeId(id));
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
//# sourceMappingURL=IdSet.js.map