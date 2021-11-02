import { encodeId } from 'ataraxia-transport';
/**
 * `Map`-like structure where keys are buffers with identifiers.
 */
export class IdMap {
    constructor() {
        this.data = new Map();
    }
    /**
     * Associate the given id with some data.
     *
     * @param id -
     *   buffer with id
     * @param data -
     *   data of id
     */
    set(id, data) {
        this.data.set(encodeId(id), data);
    }
    /**
     * Get data associated with the given id.
     *
     * @param id -
     *   buffer with id
     * @returns
     *   associated data or `undefined`
     */
    get(id) {
        return this.data.get(encodeId(id));
    }
    /**
     * Delete data associated with the given id.
     *
     * @param id -
     *   buffer with id
     */
    delete(id) {
        this.data.delete(encodeId(id));
    }
    /**
     * Get the values in this map.
     *
     * @returns
     *   iterator with values
     */
    values() {
        return this.data.values();
    }
    /**
     * Get the size of this map.
     *
     * @returns
     *   size
     */
    size() {
        return this.data.size;
    }
}
//# sourceMappingURL=IdMap.js.map