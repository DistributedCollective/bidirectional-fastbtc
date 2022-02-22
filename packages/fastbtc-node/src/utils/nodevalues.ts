/**
 * A record that holds values from multiple nodes (can be anything), and can be used to query the most popular value.
 */
export default class NodeValues {
    private nodeValues: Record<string, string>; // Values from all nodes, including myself

    constructor(initialNodeValues?: Record<string, string>) {
        if (initialNodeValues) {
            this.nodeValues = {...initialNodeValues};
        } else {
            this.nodeValues = {};
        }
    }

    public getNodeValue(nodeId: string): string | null {
        let ret: string | null = this.nodeValues[nodeId];
        if (typeof ret === 'undefined') {
            ret = null;
        }
        return ret;
    }

    public setNodeValue(nodeId: string, value: string | null) {
        if (value === null) {
            delete this.nodeValues[nodeId];
        } else {
            this.nodeValues[nodeId] = value;
        }
    }

    public deleteNodeValue(nodeId: string) {
        delete this.nodeValues[nodeId];
    }

    public getMostPopularValue(): string | null {
        const votes: Record<string, number> = {};
        for (const value of Object.values(this.nodeValues)) {
            if (typeof value === 'undefined') {
                // safeguard
                continue;
            }

            if (!votes[value]) {
                votes[value] = 0;
            }

            votes[value]++;
        }

        const entriesSortedByVotes = Object.entries(votes).sort(
            ([firstId, firstNumVotes], [secondId, secondNumVotes]) => {
                // If votes are the same, sort by id
                if (firstNumVotes === secondNumVotes) {
                    return firstId < secondId ? -1 : 1;
                }
                // Else sort most votes first
                return secondNumVotes - firstNumVotes;
            }
        );

        if (entriesSortedByVotes.length === 0) {
            return null;
        }

        return entriesSortedByVotes[0][0];
    }

    // TODO: this might not be necessary
    public getValuesByNode() {
        return {...this.nodeValues};
    }
}
