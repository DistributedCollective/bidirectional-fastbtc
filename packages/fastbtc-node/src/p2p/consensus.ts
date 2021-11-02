import {Group, Node, SynchronizedValues} from 'ataraxia';

type GroupWithNetworkId = Group & { networkId: string };

export interface ConsensusValueOpts<V> {
    group: GroupWithNetworkId;
    name: string;
    numRequired: number;
    normalizeValue?: (value: V) => any;
    defaultValue?: V;
}

export class ConsensusValue<V> {
    private synchronizedValue: SynchronizedValues<V>;
    private localValue?: V;
    private numRequired: number;
    private group: GroupWithNetworkId;
    private normalizeValue: (value: V) => any;

    constructor(opts: ConsensusValueOpts<V>) {
        this.synchronizedValue = new SynchronizedValues<V>(opts.group, opts.name, {
            defaultValue: opts.defaultValue,
        });
        this.localValue = opts.defaultValue;
        this.numRequired = opts.numRequired;
        this.group = opts.group;
        this.normalizeValue = opts.normalizeValue ?? ((v) => v);
    }

    /**
     * Get the current value if the nodes have reached consensus, or undefined otherwise
     */
    public getValueWithConsensus(): V | undefined {
        const orderedValuesAndVotes = this.getOrderedNodeValuesAndVotes();
        if (orderedValuesAndVotes.length === 0) {
            return undefined;
        }
        const [value, votes] = orderedValuesAndVotes[0];
        if (votes >= this.numRequired) {
            return value;
        }
        return undefined;
    }

    /**
     * Set local vote to `value` and propagate to other nodes.
     */
    public set(value: V): void {
        this.localValue = value;
        this.synchronizedValue.setLocal(value);
    }

    /**
     * Call this when destroying the thing to free up used resources.
     */
    public destroy(): void {
        this.synchronizedValue.destroy();
    }

    /**
     * Get array of [value, vote] pairs with the value with highest amount of votes first
     */
    public getOrderedNodeValuesAndVotes(): [V, number][] {
        const values = this.getAllNodeValues();

        const normalizedValuesAndVotes = new Map<any, [V, number]>();
        for (const value of values) {
            const key = this.normalizeValue(value);
            const previous = normalizedValuesAndVotes.get(key);
            if (typeof previous === 'undefined') {
                normalizedValuesAndVotes.set(key, [value, 1]);
            } else {
                const [previousValue, previousCount] = previous;
                normalizedValuesAndVotes.set(key, [previousValue, previousCount + 1]);
            }
        }

        const ret = [...normalizedValuesAndVotes.values()];
        ret.sort(
            (a, b) => a[1] >= b[1] ? -1 : 1
        )
        return ret;
    }

    /**
     * Get all set values from all nodes, with possible duplicates
     */
    public getAllNodeValues(): V[] {
        const values: V[] = [];

        if (typeof this.localValue !== 'undefined') {
            values.push(this.localValue);
        }

        for (const node of this.getOtherNodes()) {
            const nodeValue = this.synchronizedValue.get(node);
            if (typeof nodeValue !== 'undefined') {
                values.push(nodeValue);
            }
        }

        return values;
    }

    private getOtherNodes(): Node[] {
        // TODO: it's probably unnecessary to double-check for the ID of this node, but let's play it safe
        const myId = this.group.networkId;
        return this.group.nodes.filter(n => n.id !== myId);
    }
}
