/**
 * Set for keeping track of identifiers.
 */
export declare class IdSet {
    private data;
    constructor(values?: IterableIterator<ArrayBuffer>);
    /**
     * Add an identifier to this set.
     *
     * @param id -
     *   buffer with id
     */
    add(id: ArrayBuffer): void;
    /**
     * Check if a given identifier is in the set.
     *
     * @param id -
     *   buffer with id
     * @returns
     *   `true` if id exists in set
     */
    has(id: ArrayBuffer): boolean;
    /**
     * Delete an identifier from the set.
     *
     * @param id -
     *   buffer with id
     */
    delete(id: ArrayBuffer): void;
    /**
     * Get the number of identifiers in this set.
     *
     * @returns
     *   size
     */
    get size(): number;
    /**
     * Get all the identifiers in this set.
     *
     * @returns
     *   iterator with values
     */
    values(): IterableIterator<ArrayBuffer>;
}
//# sourceMappingURL=IdSet.d.ts.map