import {inject, injectable} from 'inversify';
import {EventScanner, Scanner} from '../rsk/scanner';
import {P2PNetwork} from '../p2p/network';
import {MessageUnion, Network, Node} from 'ataraxia';
import {TransferStatus} from '../db/models';
import {BitcoinMultisig} from '../btc/multisig';
import {Config} from '../config';
import Logger from '../logger';
import NetworkUtil from './networkutil';
import {
    BitcoinTransferBatch,
    BitcoinTransferBatchStatus,
    BitcoinTransferService,
    SerializedBitcoinTransferBatch,
} from './transfers';

type FastBTCNodeConfig = Pick<
    Config,
    'maxTransfersInBatch' | 'maxPassedBlocksInBatch' | 'numRequiredSigners'
>

// TODO: get rid of this
interface PropagateTransferBatchMessage {
}

interface RequestRSKUpdateSignatureMessage {
    transferBatch: SerializedBitcoinTransferBatch;
}

interface RequestBitcoinSignatureMessage {
    transferBatch: SerializedBitcoinTransferBatch;
}

interface TransferBatchCompleteMessage {
    transferBatch: SerializedBitcoinTransferBatch;
}

interface FastBTCMessage {
    'fastbtc:propagate-transfer-batch': PropagateTransferBatchMessage,
    'fastbtc:request-rsk-update-signature': RequestRSKUpdateSignatureMessage,
    'fastbtc:request-bitcoin-signature': RequestBitcoinSignatureMessage,
    'fastbtc:transfer-batch-complete': TransferBatchCompleteMessage,
}

@injectable()
export class FastBTCNode {
    private logger = new Logger('node');
    private networkUtil: NetworkUtil;

    constructor(
        @inject(Scanner) private eventScanner: EventScanner,
        @inject(BitcoinMultisig) private btcMultisig: BitcoinMultisig,
        @inject(P2PNetwork) private network: Network<FastBTCMessage>,
        @inject(BitcoinTransferService) private bitcoinTransferService: BitcoinTransferService,
        @inject(Config) private config: FastBTCNodeConfig
    ) {
        this.networkUtil = new NetworkUtil(network, this.logger);
        network.onNodeAvailable(this.onNodeAvailable);
        network.onNodeUnavailable(this.onNodeUnavailable);
    }

    async run() {
        await this.networkUtil.enterMainLoop(this.runIteration);
    }

    runIteration = async () => {
        const newEvents = await this.eventScanner.scanNewEvents();
        if (newEvents.length) {
            this.logger.info(`scanned ${newEvents.length} new events`);
        }
        const numTransfers = await this.eventScanner.getNumTransfers();
        const nextBatchTransfers = await this.eventScanner.getNextBatchTransfers(this.config.maxTransfersInBatch);

        const numNodesOnline = this.networkUtil.getNumNodesOnline();

        // TODO: vote for initiator
        const initiatorId = this.networkUtil.getPreferredInitiatorId();
        const isInitiator = this.networkUtil.id == initiatorId;

        this.logger.info('node id:         ', this.networkUtil.id);
        this.logger.info('initiator id:    ', initiatorId);
        this.logger.info('is initiator?    ', isInitiator);
        this.logger.info('nodes online:    ', numNodesOnline);
        this.logger.info('transfers total: ', numTransfers);
        this.logger.info('transfers queued:', nextBatchTransfers.length);

        if (!isInitiator) {
            return;
        }

        if (numNodesOnline < this.config.numRequiredSigners) {
            this.logger.info(
                `Waiting until at least ${this.config.numRequiredSigners} nodes online ` +
                `(currently ${numNodesOnline})`
            );
            return;
        }

        const transferBatch = await this.bitcoinTransferService.getNextTransferBatch();

        // TODO: all nodes just blindly trust the initiator when updating transfer batchs
        // TODO: not sure if the DB sync protocol is gooood

        if (transferBatch.status === BitcoinTransferBatchStatus.GatheringTransfers) {
            this.logger.debug('Bitcoin transfer not due yet');
            return;
        }

        if (transferBatch.status === BitcoinTransferBatchStatus.Ready) {
            if (transferBatch.rskUpdateSignatures.length < this.config.numRequiredSigners) {
                await this.network.broadcast(
                    'fastbtc:request-rsk-update-signature',
                    {
                        transferBatch: transferBatch.serialize(),
                    }
                );
                return;
            }
        }
    }

    onNodeAvailable = (node: Node<FastBTCMessage>) => {
        this.logger.log('a new node is available:', node);
    }

    onNodeUnavailable = (node: Node<FastBTCMessage>) => {
        this.logger.log('node no longer available:', node);
    }

    onMessage = (message: MessageUnion<FastBTCMessage>) => {
        switch (message.type) {
            case 'fastbtc:request-rsk-update-signature': {
                this.onRequestRskUpdateSignature(message.data, message.source);

                break
            }
            case 'fastbtc:request-bitcoin-signature': {
                this.onRequestBitcoinSignature(message.data, message.source);

                break
            }
            case 'fastbtc:transfer-batch-complete': {
                this.onTransferBatchComplete(message.data, message.source);

                break
            }
        }
    }

    onRequestRskUpdateSignature = ({transferIds, newStatus}: RequestRSKUpdateSignatureMessage, source: Node<FastBTCMessage>) => {
        if (source.id !== this.networkUtil.getPreferredInitiatorId()) {
            this.logger.warning('Rejecting RSK update signature request from node', source, 'since it is not initiator');
            return;
        }
        if (newStatus !== TransferStatus.Sent) {
            this.logger.warning('Rejecting message. Expected status', TransferStatus.Sent, 'got', newStatus);
            return;
        }
    }

    onRequestBitcoinSignature = (data: RequestBitcoinSignatureMessage, source: Node<FastBTCMessage>) => {
        if (source.id !== this.networkUtil.getPreferredInitiatorId()) {
            this.logger.warning('Rejecting Bitcoin signature request from node', source, 'since it is not initiator');
            return;
        }
    }

    onTransferBatchComplete = (data: TransferBatchCompleteMessage, source: Node<FastBTCMessage>) => {
        if (source.id !== this.networkUtil.getPreferredInitiatorId()) {
            this.logger.warning('Rejecting transfer batch complete message from node', source, 'since it is not initiator');
            return;
        }
    }
}
