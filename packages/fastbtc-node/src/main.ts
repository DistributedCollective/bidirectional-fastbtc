import {inject, injectable} from 'inversify';
import {EventScanner, Scanner} from './rsk/scanner';
import {P2PNetwork} from './p2p/network';
import {Message, Network, Node} from 'ataraxia';
import {sleep} from './utils';
import {Transfer, TransferStatus} from './db/models';

interface TransferBatch {
    transferIds: string[];
    signedBtcTransaction: string;
    rskUpdateSignatures: string[];
    nodeIds: string[];
}

@injectable()
export class FastBTCNode {
    private running = false;
    private logger = console;

    // TODO: these should be configurable or come from the blockchain
    private numRequiredSigners = 2;
    //private maxTransfersInBatch = 10;
    private maxTransfersInBatch = 1;
    private maxPassedBlocksInBatch = 5;

    constructor(
        @inject(Scanner) private eventScanner: EventScanner,
        @inject(P2PNetwork) private network: Network,
    ) {
        network.onNodeAvailable(node => {
            this.logger.info('a new node is available:', node);
        });
        network.onNodeUnavailable(node => {
            this.logger.info('node no longer available:', node);
        });

        network.onMessage(async msg => {
            if (typeof msg !== 'object' || msg === null || !msg.type) {
                this.logger.info('Received message of unknown format:', msg);
                return;
            }

            switch (msg.type) {
                case 'propagate-transfer-batch':
                    await this.onPropagateTransferBatch(msg);
                    break;
                case 'exchange:query':
                case 'exchange:membership':
                    // known cases -- need not react to these
                    break;
                default:
                    this.logger.info('Unknown message type:', msg);
            }
        });
    }

    async run() {
        this.running = true;
        await this.network.join();

        this.logger.info('Joined network, entering main loop')
        const exitHandler = () => {
            this.logger.log('SIGINT received, stopping running');
            this.running = false;
        }
        process.on('SIGINT', exitHandler);
        try {
            while(this.running) {
                await this.runIteration();

                // sleeping in loop is more graceful for ctrl-c
                for(let i = 0; i < 30 && this.running; i++) {
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

    private async runIteration() {
        const network = this.network;
        const newEvents = await this.eventScanner.scanNewEvents();
        if(newEvents.length) {
            this.logger.info(`scanned ${newEvents.length} new events`);
        }

        const initiatorId = this.getInitiatorId();
        const isInitiator = this.id === initiatorId;
        const numTransfers = await this.eventScanner.getNumTransfers();
        const nextBatchTransfers = await this.eventScanner.getNextBatchTransfers(this.maxTransfersInBatch);
        const currentBlockNumber = await this.eventScanner.getCurrentBlockNumber();
        const isBtcTransferDue = this.isBtcTransferTrue(nextBatchTransfers, currentBlockNumber);
        const successor = this.getSuccessor();

        this.logger.info('\n');
        this.logger.info('node id:         ', this.id);
        this.logger.info('initiator id:    ', initiatorId);
        this.logger.info('is initiator?    ', isInitiator);
        this.logger.info('successor id:    ', successor?.id);
        this.logger.info('nodes online:    ', network.nodes.length);
        this.logger.info('transfers total: ', numTransfers);
        this.logger.info('transfers queued:', nextBatchTransfers.length);
        this.logger.info('btc transfer due?', isBtcTransferDue);

        if (isInitiator && isBtcTransferDue) {
            await this.handleBtcBatchTransfer(nextBatchTransfers);
        }
    }

    private async handleBtcBatchTransfer(transfers: Transfer[]) {
        // TODO: obviously replace with actual signature stuff
        this.logger.log(`node #${this.getNodeIndex()}: initiate btc batch transfer`);

        const rskSignature = `fakesignature:${this.id}:rsk`;
        const transferBatch: TransferBatch = {
            transferIds: transfers.map(t => t.transferId),
            signedBtcTransaction: `fakebtctx:${this.id}`,
            rskUpdateSignatures: [rskSignature],
            nodeIds: [this.id],
        }

        const successor = this.getSuccessor();
        if (!successor) {
            throw new Error('no successor, cannot handle the situation!')
        }

        await this.eventScanner.updateTransferStatus(transfers, TransferStatus.Sending);

        await successor.send('propagate-transfer-batch', transferBatch);
    }

    private async onPropagateTransferBatch({ data }: Message) {
        // TODO: real signatures
        // TODO: validate that node has not already signed
        let transferBatch: TransferBatch = data;
        this.logger.log(`node #${this.getNodeIndex()}: received transfer batch`, transferBatch);
        const rskSignature = `fakesignature:${this.id}:rsk`;
        transferBatch = {
            transferIds: transferBatch.transferIds,
            signedBtcTransaction: `${transferBatch.signedBtcTransaction}:${this.id}`,
            rskUpdateSignatures: [...transferBatch.rskUpdateSignatures, rskSignature],
            nodeIds: [...transferBatch.nodeIds, this.id],
        }
        if (transferBatch.nodeIds.length >= this.numRequiredSigners) {
            // submit to blockchain
            this.logger.log(`node #${this.getNodeIndex()}: submitting transfer batch to blockchain:`, transferBatch);
        } else {
            const successor = this.getSuccessor();
            successor?.send('propagate-transfer-batch', transferBatch);
        }
    }

    private isBtcTransferTrue(nextBatchTransfers: Transfer[], currentBlockNumber: number): boolean {
        if (this.network.nodes.length < this.numRequiredSigners) {
            return false;
        }
        if (nextBatchTransfers.length === 0) {
            return false;
        }

        if (nextBatchTransfers.length >= this.maxTransfersInBatch) {
            return true;
        }
        const firstTransferBlock = Math.min(...nextBatchTransfers.map(t => t.rskBlockNumber));
        const passedBlocks = currentBlockNumber - firstTransferBlock;
        return passedBlocks >= this.maxPassedBlocksInBatch;
    }

    get id(): string {
        return this.network.networkId;
    }

    getInitiatorId(): string|null {
        const nodes = this.getSortedNodes();
        if(nodes.length === 0) {
            return null;
        }
        return nodes[0].id;
    }

    getSuccessor(): Node|null {
        const nodes = this.getSortedNodes();
        if(nodes.length === 0) {
            return null;
        }
        const ids = nodes.map(n => n.id);
        const thisNodeIndex = ids.indexOf(this.id);
        let successorIndex = thisNodeIndex + 1;
        if (successorIndex >= nodes.length) {
            successorIndex = 0;
        }
        return nodes[successorIndex];
    }

    getNodeIndex(): number|null {
        const ids = this.getSortedNodes().map(x => x.id);
        if (ids.length === 0)
            return null
        return ids.indexOf(this.id);
    }

    getSortedNodes(): Node[] {
        const nodes = [...this.network.nodes];
        nodes.sort((a, b) => a.id < b.id ? -1 : 1);
        return nodes;
    }
}
