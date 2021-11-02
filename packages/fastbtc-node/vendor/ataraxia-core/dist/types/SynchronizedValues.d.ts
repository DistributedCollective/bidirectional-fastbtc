import { Subscribable } from 'atvik';
import { Group } from './Group';
import { Node } from './Node';
/**
 * Options for {@link SynchronizedValues}.
 */
export interface SynchronizedValuesOptions<V, P = any> {
    /**
     * Default value to initialize this node to.
     */
    defaultValue?: V;
    /**
     * Apply a patch to the current value. Used to apply incoming patches from
     * remote nodes.
     */
    applyPatch?: (currentValue: V | undefined, patch: P) => V;
    /**
     * Generate a patch which describes changes from the previous version. Will
     * be sent to remote nodes which then use {@link applyPatch} to apply it.
     */
    generatePatch?: (currentValue: V, previousVersion: number) => P;
}
/**
 * Shared state between nodes, where each node can set its own value and other
 * nodes will keep track of them.
 *
 * ```javascript
 * const values = new SynchronizedValues(networkOrGroup, 'name-of-value', {
 *   defaultValue: []
 * });
 *
 * state.set([
 *   ...
 * ]);
 * ```
 */
export declare class SynchronizedValues<V> {
    /**
     * Debugger for messages and errors.
     */
    private readonly debug;
    /**
     * Group that this state will propagate to.
     */
    private readonly group;
    /**
     * Name of the state variable.
     */
    private readonly name;
    /**
     * Event used to emit updates.
     */
    private readonly updateEvent;
    /**
     * Nodes currently being tracked.
     */
    private readonly nodes;
    /**
     * Handles that will be released when destroyed.
     */
    private readonly handles;
    /**
     * Increasing version number of the local value. This will increase every
     * time the local value is set.
     */
    private localVersion;
    /**
     * Current local value.
     */
    private localValue?;
    /**
     * Function used to apply a patch to the current value.
     */
    private applyPatch;
    /**
     * Function used to generate a patch.
     */
    private generatePatch;
    constructor(group: Group, name: string, options?: SynchronizedValuesOptions<V>);
    /**
     * Destroy this instance. Destroying an instance will stop it from tracking
     * any more state changes.
     */
    destroy(): void;
    /**
     * Event emitted when the state of a node is updated.
     *
     * @returns
     *   subscribable for event
     */
    get onUpdate(): Subscribable<this, [node: Node, value: V | undefined]>;
    /**
     * Get the value associated with a node.
     *
     * @param node -
     *   node to get value for
     * @returns
     *   value if present or `undefined`
     */
    get(node: Node): V | undefined;
    /**
     * Set the current local value. This will try to synchronize it to other
     * nodes in the current group.
     *
     * @param value -
     *   the local value
     */
    setLocal(value: V): void;
    /**
     * Update the current value.
     *
     * @param func -
     *   function that will receive the current value and version and should
     *   generate the new value
     */
    updateLocal(func: (currentValue: V | undefined, version: number) => V): void;
    /**
     * Handle a new node becoming available. In this case we ask them about
     * all of their state.
     *
     * @param node -
     *   node that is becoming available
     */
    private handleNodeAvailable;
    /**
     * Handle a node becoming unavailable. Will emit events about its value not
     * being available and queue it up for removal.
     *
     * @param node -
     *   node that is no longer available
     */
    private handleNodeUnavailable;
    private handleMessage;
    /**
     * Generate and send a patch to a node.
     *
     * @param node -
     *   node the patch is being sent to
     * @param lastVersion -
     *   the version to generate a patch from
     */
    private sendStatePatch;
}
//# sourceMappingURL=SynchronizedValues.d.ts.map