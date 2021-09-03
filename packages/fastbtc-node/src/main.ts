import {inject, injectable} from 'inversify';
import {EventScanner, Scanner} from './rsk/scanner';
import {P2PNetwork} from './p2p/network';
import {Network} from 'ataraxia';
import {sleep} from './utils';
import {Transfer} from './db/models';

@injectable()
export class FastBTCNode {
    private running = false;
    private numRequiredSigners = 2;
    private logger = console;

    constructor(
        @inject(Scanner) private eventScanner: EventScanner,
        @inject(P2PNetwork) private network: Network,
    ) {
        network.onNodeAvailable(node => {
            this.logger.info('A new node is available', node);
        });
        network.onNodeUnavailable(node => {
            this.logger.info('Node no longer available', node);
        });
        network.onMessage(msg => {
            this.logger.info('A new message was received:', msg);
        });
    }

    async run() {
        this.running = true;
        await this.network.join();

        this.logger.info('Joined network, entering main loop')
        try {
            while(this.running) {
                await this.runIteration();
                await sleep(30_000);
            }
        } finally {
            await this.network.leave();
        }
    }

    private async runIteration() {
        const network = this.network;
        const newEvents = await this.eventScanner.scanNewEvents();
        if(newEvents.length) {
            this.logger.info(`scanned ${newEvents.length} new events`);
        }

        const initiatorId = this.getInitiatorId();
        const isInitiator = network.networkId === initiatorId;
        const nextBatchTransfers = await this.eventScanner.getNextBatchTransfers();
        const isBtcTransferDue = network.nodes.length >= this.numRequiredSigners && nextBatchTransfers.length >= 1;

        this.logger.info('\n');
        this.logger.info('node id:         ', network.networkId);
        this.logger.info('initiator id:    ', initiatorId);
        this.logger.info('is initiator?    ', isInitiator);
        this.logger.info('nodes online:    ', network.nodes.length);
        this.logger.info('transfers queued:', nextBatchTransfers.length);
        this.logger.info('distribution due?', isBtcTransferDue);

        if (isInitiator && isBtcTransferDue) {
            await this.handleBtcBatchTransfer(nextBatchTransfers);
        }
    }

    private async handleBtcBatchTransfer(transfers: Transfer[]) {

    }

    getInitiatorId(): string|null {
        const ids = this.network.nodes.map(n => n.id);
        if(ids.length === 0) {
            return null;
        }
        ids.sort();
        return ids[0];
    }
}
