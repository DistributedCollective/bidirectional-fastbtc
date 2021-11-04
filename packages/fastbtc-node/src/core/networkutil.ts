import {Network, Node} from 'ataraxia';
import {sleep} from '../utils';
import Logger from '../logger';

/**
 * Utility class for abstracting some common Ataraxia network tasks
 */
export default class NetworkUtil<MessageTypes extends object = any> {
    private running = false;

    public constructor(
        private network: Network<MessageTypes>,
        private logger: Logger = new Logger('network')
    ) {
    }

    // XXX: should maybe be elsewhere
    async enterMainLoop(runIteration: () => Promise<void>) {
        this.running = true;
        await this.network.join();

        this.logger.info('Joined network, entering main loop')
        const exitHandler = () => {
            this.logger.log('SIGINT received, stopping running');
            this.running = false;
        }
        process.on('SIGINT', exitHandler);
        try {
            while (this.running) {
                try {
                    await runIteration();
                } catch (e) {
                    this.logger.error('Error when running iteration', e);
                }

                // sleeping in loop is more graceful for ctrl-c
                for (let i = 0; i < 30 && this.running; i++) {
                    await sleep(1_000);
                }
            }
        } finally {
            process.off('SIGINT', exitHandler);
            this.logger.log('waiting to leave network gracefully');
            await this.network.leave();
            this.logger.log('network left');
        }
    }

    // Successor / etc stuff

    public get id(): string {
        return this.network.networkId;
    }

    public getPreferredInitiatorId(): string | null {
        const nodeIds = this.getSortedNodeIds();
        if (nodeIds.length === 0) {
            return null;
        }
        return nodeIds[0];
    }

    // Not sure if necessary
    public getSuccessor(): Node<MessageTypes> | null {
        return this.getSuccessorFor(this.id);
    }

    public getNumNodesOnline(): number {
        return this.getNodeIds().length;
    }

    //getNodeIndex(): number | null {
    //    const ids = this.getSortedNodeIds();
    //    if (ids.length === 0) {
    //        return null
    //    }
    //    return ids.indexOf(this.id);
    //}

    private getSuccessorFor(nodeId: string): Node<MessageTypes> | null {
        const nodeIds = this.getSortedNodeIds();
        if (nodeIds.length <= 1) {
            return null;
        }
        const thisNodeIndex = nodeIds.indexOf(nodeId);
        let successorIndex = thisNodeIndex + 1;
        if (successorIndex >= nodeIds.length) {
            successorIndex = 0;
        }
        const successorId = nodeIds[successorIndex];
        return this.getNodeById(successorId);
    }

    private getSortedNodeIds(): string[] {
        const nodeIds = this.getNodeIds();
        nodeIds.sort();
        return nodeIds;
    }

    private getNodeIds(): string[] {
        const nodeIds = this.network.nodes.map(n => n.id);

        // Ataraxia > 0.11 doesn't include current node in this.network.nodes
        if (nodeIds.indexOf(this.id) === -1) {
            nodeIds.push(this.id);
        }

        return nodeIds;
    }

    private getNodeById(id: string): Node<MessageTypes> | null {
        return this.network.nodes.find(n => n.id === id) ?? null;
    }
}
