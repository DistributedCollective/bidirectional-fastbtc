import {inject, injectable} from 'inversify';
import {EventScanner, getTransferId, Scanner} from './rsk/scanner';
import {P2PNetwork} from './p2p/network';
import {Message, Network, Node} from 'ataraxia';
import {sleep} from './utils';
import {Transfer, TransferStatus} from './db/models';
import {BitcoinMultisig, PartiallySignedBitcoinTransaction} from './btc/multisig';
import {Config} from './config';

interface TransferBatch {
    transferIds: string[];
    signedBtcTransaction: PartiallySignedBitcoinTransaction;
    rskUpdateSignatures: string[];
    nodeIds: string[];
}

type FastBTCNodeConfig = Pick<
    Config,
    'maxTransfersInBatch' | 'maxPassedBlocksInBatch' | 'numRequiredSigners'
>

@injectable()
export class FastBTCNode {
    private running = false;
    private logger = console;

    // TODO: these should be configurable or come from the blockchain
    private numRequiredSigners: number;
    private maxTransfersInBatch: number;
    private maxPassedBlocksInBatch: number;

    constructor(
        @inject(Scanner) private eventScanner: EventScanner,
        @inject(BitcoinMultisig) private btcMultisig: BitcoinMultisig,
        @inject(P2PNetwork) private network: Network,
        @inject(Config) private config: FastBTCNodeConfig
    ) {
        this.numRequiredSigners = config.numRequiredSigners;
        this.maxTransfersInBatch = config.maxTransfersInBatch;
        this.maxPassedBlocksInBatch = config.maxPassedBlocksInBatch;

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

            // TODO: add error handling if action fails
            switch (msg.type) {
                case 'propagate-transfer-batch':
                    await this.onPropagateTransferBatch(msg);
                    break;
                case 'transfer-batch-complete':
                    await this.onTransferBatchComplete(msg);
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
            while (this.running) {
                try {
                    await this.runIteration();
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

    private async runIteration() {
        const network = this.network;
        const newEvents = await this.eventScanner.scanNewEvents();
        if (newEvents.length) {
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

        const transferIds = transfers.map(t => t.transferId);

        const rskSignature = await this.eventScanner.signTransferStatusUpdate(
            transferIds,
            TransferStatus.Sent
        );

        const bitcoinTx = await this.btcMultisig.createPartiallySignedTransaction(transfers);
        const transferBatch: TransferBatch = {
            transferIds,
            signedBtcTransaction: bitcoinTx,
            rskUpdateSignatures: [rskSignature],
            nodeIds: [this.id],
        }

        const successor = this.getSuccessor();
        if (!successor) {
            throw new Error('no successor, cannot handle the situation!')
        }

        await this.eventScanner.updateLocalTransferStatus(transfers, TransferStatus.Sending);

        await successor.send('propagate-transfer-batch', transferBatch);
    }

    private async onPropagateTransferBatch({data}: Message) {
        let transferBatch: TransferBatch = data;
        this.logger.log(`node #${this.getNodeIndex()}: received transfer batch`, transferBatch);

        // validate the transfer batch
        const transfers: Transfer[] = [];
        for (const psbtTransfer of this.btcMultisig.getTransactionTransfers(transferBatch.signedBtcTransaction)) {
            const depositInfo = await this.eventScanner.fetchDepositInfo(psbtTransfer.btcAddress, psbtTransfer.nonce);
            const transfer = await this.eventScanner.getTransferById(getTransferId(psbtTransfer.btcAddress, psbtTransfer.nonce));

            if (transfer.status != TransferStatus.New) {
                // TODO: log to database
                throw new Error(`Transfer ${transfer} had invalid status ${transfer.status}, expected ${TransferStatus.New}`);
            }

            const depositId = `${transfer.btcAddress}/${transfer.nonce}`;

            if (!transfer.amountSatoshi.eq(depositInfo.amountSatoshi)) {
                throw new Error(`The deposit ${depositId} has ${depositInfo.amountSatoshi} in RSK but ${transfer.amountSatoshi} in proposed BTC batch`);
            }

            if (depositInfo.status != TransferStatus.New) {
                throw new Error(`The RSK contract has invalid state for deposit ${depositId}; expected ${TransferStatus.New}, got ${depositInfo.status}`);
            }

            transfers.push(transfer);
        }

        const rskSignature = await this.eventScanner.signTransferStatusUpdate(
            transferBatch.transferIds,
            TransferStatus.Sent
        );

        const signedTransaction = this.btcMultisig.signTransaction(transferBatch.signedBtcTransaction);

        transferBatch = {
            transferIds: transferBatch.transferIds,
            signedBtcTransaction: signedTransaction,
            rskUpdateSignatures: [...transferBatch.rskUpdateSignatures, rskSignature],
            nodeIds: [...transferBatch.nodeIds, this.id],
        }

        await this.eventScanner.updateLocalTransferStatus(transfers, TransferStatus.Sending);
        if (transferBatch.nodeIds.length >= this.numRequiredSigners) {
            await this.eventScanner.updateLocalTransferStatus(transfers, TransferStatus.Sending);

            // submit to blockchain
            this.logger.log(`node #${this.getNodeIndex()}: submitting transfer batch to blockchain:`, transferBatch);
            await this.btcMultisig.submitTransaction(transferBatch.signedBtcTransaction);
            await this.eventScanner.markTransfersAsSent(transferBatch.transferIds, transferBatch.rskUpdateSignatures);
            this.logger.log(`node #${this.getNodeIndex()}: events marked as sent in rsk`);
            await this.network.broadcast('transfer-batch-complete', transferBatch);
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

    getInitiatorId(): string | null {
        const nodes = this.getSortedNodes();
        if (nodes.length === 0) {
            return null;
        }
        return nodes[0].id;
    }

    getSuccessor(): Node | null {
        const nodes = this.getSortedNodes();
        if (nodes.length === 0) {
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

    getNodeIndex(): number | null {
        const ids = this.getSortedNodes().map(x => x.id);
        if (ids.length === 0) {
            return null
        }
        return ids.indexOf(this.id);
    }

    getSortedNodes(): Node[] {
        const nodes = [...this.network.nodes];
        nodes.sort((a, b) => a.id < b.id ? -1 : 1);
        return nodes;
    }

    private async onTransferBatchComplete({data}: Message) {
        let transferBatch: TransferBatch = data;
        console.log(`Got batch: ${data}`);

        // TODO: verify batch again
        await this.eventScanner.updateLocalTransferStatus(
            transferBatch.transferIds,
            TransferStatus.Sent
        )
    }
}
