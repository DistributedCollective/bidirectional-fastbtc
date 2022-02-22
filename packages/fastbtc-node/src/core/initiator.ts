import {MessageUnion, Network, Node} from 'ataraxia';
import {sleep} from '../utils';
import NodeValues from '../utils/nodevalues';
import Logger from '../logger';

interface SyncInitiatorMessage {
    initiatorId: string | null;
}
interface InitiatorVotingMessage {
    'fastbtc:initiator:sync-request': SyncInitiatorMessage,
    'fastbtc:initiator:sync-response': SyncInitiatorMessage,
}

/**
 * A class for deciding the initiator of the network.
 *
 * The first version only contains support for a "sticky" initiator so it doesn't change randomly.
 * Further versions should also support rotating the initiator.
 */
export class InitiatorVoting {
    private logger = new Logger('initiatorvoting');
    private nodeInitiatorIds = new NodeValues();
    private updateIntervalId?: NodeJS.Timer;

    constructor(
        private network: Network<InitiatorVotingMessage>,
    ) {
        network.onNodeUnavailable(this.onNodeUnavailable)
        network.onMessage(this.onMessage);
    }

    /**
     * Start updating state from the network periodically
     */
    public async start() {
        if (this.updateIntervalId) {
            this.logger.warning('Already started, not starting again');
            return;
        }
        await this.syncInitiatorFromNetwork();
        this.updateIntervalId = setInterval(() => {
            this.syncInitiatorFromNetwork().catch(err => {
                this.logger.exception(
                    err,
                    'Error syncing initiator from network (periodical)'
                );
            })
        }, 10_000);
    }

    /**
     * Stop updates.
     */
    public async stop() {
        if (!this.updateIntervalId) {
            this.logger.warning('Not started, cannot stop');
            return;
        }
        clearInterval(this.updateIntervalId);
        this.updateIntervalId = undefined;
    }

    /**
     * Synchronize with the network and update local decision on the initiator based on network consensus.
     */
    public async syncInitiatorFromNetwork(tries: number = 5) {
        const sleepTimeMs = 2000;

        let initiatorId: string|null = null;

        // Sleep a random time for starters so everything doesn't happen in lockstep
        await sleep(Math.floor(Math.random() * sleepTimeMs));

        // Ask the network for the most popular initiator value, wait a little bit for the results to propagate,
        // and set it as a local value.
        // We try this multiple times, because answers might not get to us instantly.
        // If no initiator is found even after retries, we decide on the initiator algorithmically.
        while (initiatorId === null && tries > 0) {
            tries--;

            await this.network.broadcast('fastbtc:initiator:sync-request', {
                initiatorId: this.nodeInitiatorIds.getNodeValue(this.id),
            });

            // Wait a little while for it to propagate
            await sleep(sleepTimeMs);

            initiatorId = this.nodeInitiatorIds.getMostPopularValue();

            // The following is log spam for debugging -- can be removed
            //this.logger.debug('initiatorvoting tries:', tries);
            //this.logger.debug('initiatorvoting popular:', initiatorId);
            //this.logger.debug('initiatorvoting all:', JSON.stringify(this.nodeInitiatorIds.getValuesByNode()));
            //this.logger.debug('initiatorvoting nodes online:', this.network.nodes.length);

            const nodeIds = this.getNodeIds();
            if (initiatorId !== null && nodeIds.indexOf(initiatorId) === -1) {
                this.logger.warning(
                    'initiator id from network %s is not among nodes %s',
                    initiatorId,
                    nodeIds,
                )
                initiatorId = null;
            }
        }

        if (initiatorId === null) {
            // No initiator got from the network -- decide on one based on the default algorithm
            initiatorId = this.getDefaultInitiatorId();
            this.logger.debug(
                'Could not get initiator consensus from the network -- decided on %s',
                initiatorId,
            )
        }

        const previousInitiatorId = this.nodeInitiatorIds.getNodeValue(this.id)
        if (initiatorId !== previousInitiatorId) {
            this.logger.debug(
                'Updating local initiator id from %s to %s',
                previousInitiatorId,
                initiatorId,
            );
            this.nodeInitiatorIds.setNodeValue(this.id, initiatorId);
        }

        await this.network.broadcast('fastbtc:initiator:sync-response', {
            initiatorId: this.nodeInitiatorIds.getNodeValue(this.id),
        });
    }

    /**
     * Get the initiator id as this node sees it best
     */
    public getInitiatorId(): string | null {
        // TODO: not sure if we should return local value or the value based on consensus
        return this.nodeInitiatorIds.getNodeValue(this.id);
        //return this.nodeInitiatorIds.getMostPopularValue();
    }

    private onNodeUnavailable = (node: Node) => {
        this.nodeInitiatorIds.deleteNodeValue(node.id);
        // If the node was an initiator, delete our local state
        if(node.id === this.nodeInitiatorIds.getNodeValue(this.id)) {
            this.logger.debug(
                'Initiator node %s no longer available',
                node.id,
            );
            this.nodeInitiatorIds.deleteNodeValue(this.id);

            // NOTE: it's possible that this gets executed multiple times simultanously (since it's probably also
            // polling in the background ad there's no mutex) -- however it should not be the worst thing in the world.
            this.syncInitiatorFromNetwork().catch(err => {
                this.logger.exception(
                    err,
                    'Error syncing initiator from network after it became unavailable'
                );
            })
        }
    }

    private onMessage = async (message: MessageUnion<InitiatorVotingMessage>) => {
        switch (message.type) {
            case 'fastbtc:initiator:sync-request':
                this.nodeInitiatorIds.setNodeValue(message.source.id, message.data.initiatorId);
                // Maybe it's good to communicate the null case too
                //if (this.localInitiatorId === null) {
                //    return;
                //}
                await message.source.send(
                    'fastbtc:initiator:sync-response',
                    {
                        initiatorId: this.nodeInitiatorIds.getNodeValue(this.id),
                    }
                );
                break
            case 'fastbtc:initiator:sync-response':
                this.nodeInitiatorIds.setNodeValue(message.source.id, message.data.initiatorId);
                break;
        }
    }

    private get id(): string {
        return this.network.networkId;
    }

    // Get the initiator id if the network is undecided on one
    private getDefaultInitiatorId(): string | null {
        const nodeIds = this.getSortedNodeIds();
        if (nodeIds.length === 0) {
            return null;
        }
        return nodeIds[0];
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
}
