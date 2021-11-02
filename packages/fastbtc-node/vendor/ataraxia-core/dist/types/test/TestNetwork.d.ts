import { Network } from '../Network';
declare enum ConnectionType {
    None = 0,
    Forward = 1,
    Backward = 2,
    Both = 3
}
/**
 * Network intended for test usage. Helps with creating a network and modifying
 * connections to test code that uses the network.
 */
export declare class TestNetwork {
    private nodeInfo;
    private connectionInfo;
    constructor();
    /**
     * Get node information, including its generated id and topology.
     *
     * @param id -
     * @returns
     *   info associated with the node
     */
    private getNode;
    private getConnection;
    /**
     * Modify how nodes A and B connect to each other.
     *
     * @param a -
     *   first node
     * @param b -
     *   second node
     * @param type -
     *   type of connection to have
     * @returns
     *   self
     */
    changeConnection(a: string, b: string, type: ConnectionType): this;
    /**
     * Consolidate the network. This will wait for changes to applied before
     * resolving.
     *
     * @returns
     *   promise that resolves when changes to the networks have been fully
     *   applied
     */
    consolidate(): Promise<void>;
    /**
     * Create a bidirectional connection between two nodes.
     *
     * @param a -
     *   first node
     * @param b -
     *   second node
     * @returns
     *   self
     */
    bidirectional(a: string, b: string): this;
    /**
     * Create a connection from node `a` to node `b` but not from `b` to `a`.
     *
     * @param a -
     *   first node
     * @param b -
     *   second node
     * @returns
     *   self
     */
    forward(a: string, b: string): this;
    /**
     * Disconnect the connection between two nodes.
     *
     * @param a -
     *   first node
     * @param b -
     *   second node
     * @returns
     *   self
     */
    disconnect(a: string, b: string): this;
    /**
     * Get the network associated with the specified node.
     *
     * @param id -
     *   identifier of node
     * @returns
     *   network instance
     */
    network(id: string): Network;
    /**
     * Shutdown all the nodes and their networks.
     */
    shutdown(): Promise<void>;
}
export {};
//# sourceMappingURL=TestNetwork.d.ts.map