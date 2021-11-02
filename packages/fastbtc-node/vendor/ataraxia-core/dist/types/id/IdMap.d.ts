/**
 * `Map`-like structure where keys are buffers with identifiers.
 */
export declare class IdMap<T> {
    private data;
    constructor();
    /**
     * Associate the given id with some data.
     *
     * @param id -
     *   buffer with id
     * @param data -
     *   data of id
     */
    set(id: ArrayBuffer, data: T): void;
    /**
     * Get data associated with the given id.
     *
     * @param id -
     *   buffer with id
     * @returns
     *   associated data or `undefined`
     */
    get(id: ArrayBuffer): T | undefined;
    /**
     * Delete data associated with the given id.
     *
     * @param id -
     *   buffer with id
     */
    delete(id: ArrayBuffer): void;
    /**
     * Get the values in this map.
     *
     * @returns
     *   iterator with values
     */
    values(): IterableIterator<T>;
    /**
     * Get the size of this map.
     *
     * @returns
     *   size
     */
    size(): number;
}
//# sourceMappingURL=IdMap.d.ts.map