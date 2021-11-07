import {inject, injectable} from 'inversify';
import {EventScanner, Scanner} from '../rsk/scanner';
import {P2PNetwork} from '../p2p/network';
import {MessageUnion, Network, Node} from 'ataraxia';
import {TransferStatus} from '../db/models';
import {BitcoinMultisig, PartiallySignedBitcoinTransaction} from '../btc/multisig';
import {Config} from '../config';
import Logger from '../logger';
import NetworkUtil from './networkutil';
import {BitcoinTransferService, TransferBatch, TransferBatchDTO, TransferBatchValidator} from './transfers';

type FastBTCNodeConfig = Pick<
    Config,
    'maxTransfersInBatch' | 'maxPassedBlocksInBatch' | 'numRequiredSigners'
>

// TODO: get rid of this
interface PropagateTransferBatchMessage {
}

interface RequestRSKSendingSignatureMessage {
    transferBatchDto: TransferBatchDTO;
}

interface RequestBitcoinSignatureMessage {
    transferBatchDto: TransferBatchDTO;
}

interface TransferBatchCompleteMessage {
    transferBatchDto: TransferBatchDTO;
}

interface RSKSendingSignatureResponseMessage {
    transferBatchDto: TransferBatchDTO;
    signature: string;
    address: string;
}

interface BitcoinSignatureResponseMessage {
    transferBatchDto: TransferBatchDTO;
    signedBtcTransaction: PartiallySignedBitcoinTransaction;
}

interface FastBTCMessage {
    'fastbtc:propagate-transfer-batch': PropagateTransferBatchMessage,
    'fastbtc:request-rsk-sending-signature': RequestRSKSendingSignatureMessage,
    'fastbtc:request-bitcoin-signature': RequestBitcoinSignatureMessage,
    'fastbtc:transfer-batch-complete': TransferBatchCompleteMessage,
    'fastbtc:rsk-sending-signature-response': RSKSendingSignatureResponseMessage,
    'fastbtc:bitcoin-signature-response': BitcoinSignatureResponseMessage,
}

interface TransientInitiatorData {
    currentTransferBatch: TransferBatch|null;
    gatheredRskSentSignaturesAndAddresses: {signature: string; address: string}[];
    gatheredBitcoinSignatures: PartiallySignedBitcoinTransaction[];
}
function getEmptyTransientInitiatorData(currentTransferBatch: TransferBatch|null): TransientInitiatorData {
    return {
        currentTransferBatch,
        gatheredRskSentSignaturesAndAddresses: [],
        gatheredBitcoinSignatures: [],
    }
}

@injectable()
export class FastBTCNode {
    private logger = new Logger('node');
    private networkUtil: NetworkUtil;
    private transientInitiatorData: TransientInitiatorData = getEmptyTransientInitiatorData(null);

    constructor(
        @inject(Scanner) private eventScanner: EventScanner,
        @inject(BitcoinMultisig) private btcMultisig: BitcoinMultisig,
        @inject(P2PNetwork) private network: Network<FastBTCMessage>,
        @inject(BitcoinTransferService) private bitcoinTransferService: BitcoinTransferService,
        @inject(TransferBatchValidator) private transferBatchValidator: TransferBatchValidator,
        @inject(Config) private config: FastBTCNodeConfig
    ) {
        this.networkUtil = new NetworkUtil(network, this.logger);
        network.onNodeAvailable(this.onNodeAvailable);
        network.onNodeUnavailable(this.onNodeUnavailable);
        network.onMessage(this.onMessage);
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
        const numNodesOnline = this.networkUtil.getNumNodesOnline();

        // TODO: vote for initiator
        const initiatorId = this.networkUtil.getPreferredInitiatorId();
        const isInitiator = this.networkUtil.id == initiatorId;

        this.logger.info('node id:         ', this.networkUtil.id);
        this.logger.info('initiator id:    ', initiatorId);
        this.logger.info('is initiator?    ', isInitiator);
        this.logger.info('nodes online:    ', numNodesOnline);
        this.logger.info('transfers total: ', numTransfers);

        if (!isInitiator) {
            this.logger.info('not initiator, not doing anything');
            this.transientInitiatorData = getEmptyTransientInitiatorData(null);
            return;
        }

        if (numNodesOnline < this.config.numRequiredSigners) {
            this.logger.info(
                `Waiting until at least ${this.config.numRequiredSigners} nodes online ` +
                `(currently ${numNodesOnline})`
            );
            return;
        }

        let transferBatch = await this.bitcoinTransferService.getCurrentTransferBatch();
        transferBatch = await this.updateTransferBatchFromTransientInitiatorData(transferBatch);
        this.logger.info('transfers queued:', transferBatch.transfers.length);

        this.logger.info('TransferBatch:', transferBatch);

        if (!transferBatch.isDue()) {
            this.logger.info('TransferBatch not due')
            return;
        }

        if(!transferBatch.hasEnoughRskSendingSignatures()) {
            this.logger.info('TransferBatch does not have enough RSK Sent signatures');
            await this.network.broadcast(
                'fastbtc:request-rsk-sending-signature',
                {
                    transferBatchDto: transferBatch.getDto(),
                }
            );
            return;
        }

        if(!transferBatch.isMarkedAsSendingInRsk()) {
            this.logger.info('TransferBatch is not marked as sending in RSK');
            await this.bitcoinTransferService.markAsSendingInRsk(transferBatch);
            return;
        }

        if(!transferBatch.hasEnoughBitcoinSignatures()) {
            this.logger.info('TransferBatch does not have enough bitcoin signatures');
            await this.network.broadcast(
                'fastbtc:request-bitcoin-signature',
                {
                    transferBatchDto: transferBatch.getDto(),
                }
            );
            return;
        }

        if(!transferBatch.isSentToBitcoin()) {
            this.logger.info('TransferBatch is not sent to bitcoin');
            await this.bitcoinTransferService.sendToBitcoin(transferBatch);
            return;
        }

        if(!transferBatch.isMarkedAsMinedInRsk()) {
            // TODO: ask for signatures here
            this.logger.info('TransferBatch is not marked as mined in RSK');
            return;
        }
    }

    private async updateTransferBatchFromTransientInitiatorData(transferBatch: TransferBatch): Promise<TransferBatch> {
        if (
            !this.transientInitiatorData.currentTransferBatch ||
            !this.transientInitiatorData.currentTransferBatch.hasMatchingTransferIds(transferBatch.getTransferIds())
        ) {
            this.transientInitiatorData = getEmptyTransientInitiatorData(transferBatch);
            return transferBatch;
        }

        let updated = false;
        if (this.transientInitiatorData.gatheredRskSentSignaturesAndAddresses.length > 0) {
            transferBatch = await this.bitcoinTransferService.addRskSendingSignatures(
                transferBatch,
                this.transientInitiatorData.gatheredRskSentSignaturesAndAddresses
            );
            this.transientInitiatorData.gatheredRskSentSignaturesAndAddresses = [];
            this.transientInitiatorData.currentTransferBatch = transferBatch;
            updated = true;
        }

        if (this.transientInitiatorData.gatheredBitcoinSignatures.length > 0) {
            transferBatch = await this.bitcoinTransferService.addBitcoinSignatures(
                transferBatch,
                this.transientInitiatorData.gatheredBitcoinSignatures
            );
            this.transientInitiatorData.gatheredBitcoinSignatures = [];
            this.transientInitiatorData.currentTransferBatch = transferBatch;
            updated = true;
        }

        if (updated) {
            await this.bitcoinTransferService.updateStoredTransferBatch(transferBatch);
        }
        return transferBatch;
    }

    onNodeAvailable = (node: Node<FastBTCMessage>) => {
        this.logger.log('a new node is available:', node);
    }

    onNodeUnavailable = (node: Node<FastBTCMessage>) => {
        this.logger.log('node no longer available:', node);
    }

    onMessage = (message: MessageUnion<FastBTCMessage>) => {
        let promise: Promise<any> | null = null;
        switch (message.type) {
            case 'fastbtc:request-rsk-sending-signature': {
                promise = this.onRequestRskSendingSignature(message.data, message.source);
                break
            }
            case 'fastbtc:request-bitcoin-signature': {
                promise = this.onRequestBitcoinSignature(message.data, message.source);
                break
            }
            case 'fastbtc:transfer-batch-complete': {
                promise = this.onTransferBatchComplete(message.data, message.source);
                break
            }
            case 'fastbtc:rsk-sending-signature-response': {
                promise = this.onRskSendingSignatureResponse(message.data, message.source);
                break;
            }
            case 'fastbtc:bitcoin-signature-response': {
                promise = this.onBitcoinSignatureResponse(message.data, message.source);
                break;
            }
        }
        if(promise) {
            this.logger.debug('received message:');
            this.logger.debug('type  ', message.type);
            this.logger.debug('source', message.source);
            this.logger.debug('data  ', JSON.stringify(message.data, null, 2));

            promise.catch(err => this.logger.exception(err, 'error processing message:', message));
        }
    }

    onRequestRskSendingSignature = async (data: RequestRSKSendingSignatureMessage, source: Node<FastBTCMessage>) => {
        if (source.id !== this.networkUtil.getPreferredInitiatorId()) {
            this.logger.warning('Rejecting RSK update signature request from node', source, 'since it is not initiator');
            return;
        }

        let transferBatch = await this.bitcoinTransferService.loadFromDto(data.transferBatchDto);
        if (!transferBatch) {
            this.logger.warning("TransferBatch cannot be loaded because one or more transfers haven't been synchronized");
            return;
        }

        await this.transferBatchValidator.validateForSigningRskSentUpdate(transferBatch);

        await this.bitcoinTransferService.updateStoredTransferBatch(transferBatch);

        // TODO: this validates again
        const {address, signature} =  await this.bitcoinTransferService.signRskSendingUpdate(transferBatch);
        await source.send('fastbtc:rsk-sending-signature-response', {
            transferBatchDto: transferBatch.getDto(),
            address,
            signature
        });
    }

    onRequestBitcoinSignature = async (data: RequestBitcoinSignatureMessage, source: Node<FastBTCMessage>) => {
        if (source.id !== this.networkUtil.getPreferredInitiatorId()) {
            this.logger.warning('Rejecting Bitcoin signature request from node', source, 'since it is not initiator');
            return;
        }

        let transferBatch = await this.bitcoinTransferService.loadFromDto(data.transferBatchDto);
        if (!transferBatch) {
            this.logger.warning("TransferBatch cannot be loaded because one or more transfers haven't been synchronized");
            return;
        }

        await this.transferBatchValidator.validateForSigningBitcoinTransaction(transferBatch);

        await this.bitcoinTransferService.updateStoredTransferBatch(transferBatch);

        const signedBtcTransaction = await this.btcMultisig.signTransaction(transferBatch.initialBtcTransaction);
        await source.send('fastbtc:bitcoin-signature-response', {
            transferBatchDto: transferBatch.getDto(),
            signedBtcTransaction,
        });
    }

    onTransferBatchComplete = async (data: TransferBatchCompleteMessage, source: Node<FastBTCMessage>) => {
        if (source.id !== this.networkUtil.getPreferredInitiatorId()) {
            this.logger.warning('Rejecting transfer batch complete message from node', source, 'since it is not initiator');
            return;
        }
    }

    onRskSendingSignatureResponse = async (data: RSKSendingSignatureResponseMessage, source: Node<FastBTCMessage>) => {
        if (!this.networkUtil.isThisNodeInitiator()) {
            this.logger.warning('Received rsk sending signature response even though I am not the initiator');
            return;
        }
        if (!this.transientInitiatorData.currentTransferBatch) {
            this.logger.warning('Cannot deal with received rsk sending signature response because I don\'t know the current transfer batch');
            return;
        }
        const {transferBatchDto, address, signature} = data;
        this.transientInitiatorData.currentTransferBatch.validateMatchesDto(transferBatchDto);
        this.transientInitiatorData.gatheredRskSentSignaturesAndAddresses.push({ signature, address});
    }

    onBitcoinSignatureResponse = async (data: BitcoinSignatureResponseMessage, source: Node<FastBTCMessage>) => {
        if (!this.networkUtil.isThisNodeInitiator()) {
            this.logger.warning('Received bitcoin signature response even though I am not the initiator');
            return;
        }
        if (!this.transientInitiatorData.currentTransferBatch) {
            this.logger.warning('Cannot deal with received bitcoin signature response because I don\'t know the current transfer batch');
            return;
        }

        const {transferBatchDto, signedBtcTransaction} = data;
        this.transientInitiatorData.currentTransferBatch.validateMatchesDto(transferBatchDto);
        this.transientInitiatorData.gatheredBitcoinSignatures.push(signedBtcTransaction);
    }
}
