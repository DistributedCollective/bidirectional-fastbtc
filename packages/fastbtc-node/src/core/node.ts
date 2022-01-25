/**
 * High-level peer-to-peer data flow logic
 */
import {inject, injectable} from 'inversify';
import {EventScanner, Scanner} from '../rsk/scanner';
import {P2PNetwork} from '../p2p/network';
import {MessageUnion, Network, Node} from 'ataraxia';
import {BitcoinMultisig, PartiallySignedBitcoinTransaction} from '../btc/multisig';
import {Config} from '../config';
import Logger from '../logger';
import NetworkUtil from './networkutil';
import {BitcoinTransferService, TransferBatch, TransferBatchDTO, TransferBatchValidator} from './transfers';
import {DBLogging} from "../db/dblogging";

type FastBTCNodeConfig = Pick<
    Config,
    'maxTransfersInBatch' | 'maxPassedBlocksInBatch' | 'numRequiredSigners'
>

interface TransferBatchMessage {
    transferBatchDto: TransferBatchDTO;
}

type RequestRSKSendingSignatureMessage = TransferBatchMessage;

type RequestBitcoinSignatureMessage = TransferBatchMessage;

type SendingToBitcoinMessage = TransferBatchMessage;

type RequestRSKMinedSignatureMessage = TransferBatchMessage;

type TransferBatchCompleteMessage = TransferBatchMessage

type PurgeTransferBatchMessage = TransferBatchMessage

type RSKSendingSignatureResponseMessage = TransferBatchMessage & {
    signature: string;
    address: string;
}

type BitcoinSignatureResponseMessage = TransferBatchMessage & {
    signedBtcTransaction: PartiallySignedBitcoinTransaction;
}

type RSKMinedSignatureResponseMessage = TransferBatchMessage & {
    signature: string;
    address: string;
}

interface FastBTCMessage {
    'fastbtc:request-rsk-sending-signature': RequestRSKSendingSignatureMessage,
    'fastbtc:request-bitcoin-signature': RequestBitcoinSignatureMessage,
    'fastbtc:request-rsk-mined-signature': RequestRSKSendingSignatureMessage,
    'fastbtc:sending-to-bitcoin': SendingToBitcoinMessage,
    'fastbtc:transfer-batch-complete': TransferBatchCompleteMessage,
    'fastbtc:purge-transfer-batch': PurgeTransferBatchMessage,
    'fastbtc:rsk-sending-signature-response': RSKSendingSignatureResponseMessage,
    'fastbtc:bitcoin-signature-response': BitcoinSignatureResponseMessage,
    'fastbtc:rsk-mined-signature-response': RSKMinedSignatureResponseMessage,
}

interface TransientInitiatorData {
    currentTransferBatch: TransferBatch|null;
    gatheredRskSendingSignaturesAndAddresses: {signature: string; address: string}[];
    gatheredBitcoinSignatures: PartiallySignedBitcoinTransaction[];
    gatheredRskMinedSignaturesAndAddresses: {signature: string; address: string}[];
}

function getEmptyTransientInitiatorData(currentTransferBatch: TransferBatch|null): TransientInitiatorData {
    return {
        currentTransferBatch,
        gatheredRskSendingSignaturesAndAddresses: [],
        gatheredBitcoinSignatures: [],
        gatheredRskMinedSignaturesAndAddresses: [],
    }
}

function copyTransientInitiatorData(data: TransientInitiatorData): TransientInitiatorData {
    return {
        currentTransferBatch: data.currentTransferBatch ? data.currentTransferBatch.copy() : null,
        gatheredRskSendingSignaturesAndAddresses: [...data.gatheredRskSendingSignaturesAndAddresses],
        gatheredBitcoinSignatures: [...data.gatheredBitcoinSignatures],
        gatheredRskMinedSignaturesAndAddresses: [...data.gatheredRskMinedSignaturesAndAddresses],
    }
}

/**
 * The non-boilerplate entry point to the whole thing. Contains high-level peer-to-peer data flow logic.
 * Actual business logic is delegated to BitcoinTransferService
 */
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
        @inject(Config) private config: FastBTCNodeConfig,
        @inject(DBLogging) private dbLogging: DBLogging
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

        // we could obtain consensus for the initiator, but it's not strictly required
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

        if (!transferBatch.hasValidTransferState()) {
            this.logger.warning(
                'TransferBatch has invalid transfer state -- purging it and starting with a fresh one!'
            );
            await this.bitcoinTransferService.purgeTransferBatch(transferBatch);
            await this.network.broadcast(
                'fastbtc:purge-transfer-batch',
                {
                    transferBatchDto: transferBatch.getDto(),
                }
            );
            return;
        }

        if (!transferBatch.isDue()) {
            this.logger.info('TransferBatch not due')
            return;
        }

        if(!transferBatch.hasEnoughRskSendingSignatures()) {
            this.logger.info('TransferBatch does not have enough RSK sending signatures');
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
            await this.network.broadcast(
                'fastbtc:sending-to-bitcoin',
                {
                    transferBatchDto: transferBatch.getDto(),
                }
            );
            await this.bitcoinTransferService.sendToBitcoin(transferBatch);
            return;
        }

        if(!transferBatch.hasEnoughRskMinedSignatures()) {
            this.logger.info('TransferBatch does not have enough RSK mined signatures');
            await this.network.broadcast(
                'fastbtc:request-rsk-mined-signature',
                {
                    transferBatchDto: transferBatch.getDto(),
                }
            );
            return;
        }

        if(!transferBatch.isMarkedAsMinedInRsk()) {
            this.logger.info('TransferBatch is not marked as mined in RSK');
            await this.bitcoinTransferService.markAsMinedInRsk(transferBatch);
            await this.network.broadcast(
                'fastbtc:transfer-batch-complete',
                {
                    transferBatchDto: transferBatch.getDto(),
                }
            );
            return;
        }
    }

    private async updateTransferBatchFromTransientInitiatorData(transferBatch: TransferBatch): Promise<TransferBatch> {
        // make copies so it doesn't get mutated in between, and reset the transient data
        const {
            currentTransferBatch: transferBatchDuringGathering,
            gatheredRskSendingSignaturesAndAddresses,
            gatheredBitcoinSignatures,
            gatheredRskMinedSignaturesAndAddresses,
        } = copyTransientInitiatorData(this.transientInitiatorData);
        this.transientInitiatorData = getEmptyTransientInitiatorData(transferBatch);

        if (
            !transferBatchDuringGathering ||
            !transferBatchDuringGathering.hasMatchingTransferIds(transferBatch.getTransferIds())
        ) {
            // we received signatures for another transfer batch -- cannot do anything with them
            return transferBatch;
        }

        let updated = false;
        if (gatheredRskSendingSignaturesAndAddresses.length > 0) {
            this.logger.info('Gathered', gatheredRskSendingSignaturesAndAddresses.length, 'RSK mined signatures');
            transferBatch = await this.bitcoinTransferService.addRskSendingSignatures(
                transferBatch,
                gatheredRskSendingSignaturesAndAddresses
            );
            updated = true;
        }

        if (gatheredBitcoinSignatures.length > 0) {
            this.logger.info('Gathered', gatheredBitcoinSignatures.length, 'bitcoin signatures');
            transferBatch = await this.bitcoinTransferService.addBitcoinSignatures(
                transferBatch,
                gatheredBitcoinSignatures
            );
            updated = true;
        }

        if (gatheredRskMinedSignaturesAndAddresses.length > 0) {
            this.logger.info('Gathered', gatheredRskMinedSignaturesAndAddresses.length, 'RSK mined signatures');
            transferBatch = await this.bitcoinTransferService.addRskMinedSignatures(
                transferBatch,
                gatheredRskMinedSignaturesAndAddresses
            );
            updated = true;
        }

        if (updated) {
            this.transientInitiatorData.currentTransferBatch = transferBatch;
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

    onMessage = async (message: MessageUnion<FastBTCMessage>) => {
        let promise: Promise<any> | null = null;

        await this.dbLogging.log('messageReceived', {data: message.data, source: message.source.id});

        switch (message.type) {
            case 'fastbtc:request-rsk-sending-signature': {
                promise = this.onRequestRskSendingSignature(message.data, message.source);
                break
            }
            case 'fastbtc:request-bitcoin-signature': {
                promise = this.onRequestBitcoinSignature(message.data, message.source);
                break
            }
            case 'fastbtc:sending-to-bitcoin': {
                promise = this.onSendingToBitcoin(message.data, message.source);
                break
            }
            case 'fastbtc:request-rsk-mined-signature': {
                promise = this.onRequestRskMinedSignature(message.data, message.source);
                break
            }
            case 'fastbtc:transfer-batch-complete': {
                promise = this.onTransferBatchComplete(message.data, message.source);
                break
            }
            case 'fastbtc:purge-transfer-batch': {
                promise = this.onPurgeTransferBatch(message.data, message.source);
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
            case 'fastbtc:rsk-mined-signature-response': {
                promise = this.onRskMinedSignatureResponse(message.data, message.source);
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
        await this.handleMessageFromInitiator(data, source, async (transferBatch) => {
            // This also validates it
            const {address, signature} =  await this.bitcoinTransferService.signRskSendingUpdate(transferBatch);

            await this.bitcoinTransferService.updateStoredTransferBatch(transferBatch);

            await source.send('fastbtc:rsk-sending-signature-response', {
                transferBatchDto: transferBatch.getDto(),
                address,
                signature
            });
        });
    }

    onRequestBitcoinSignature = async (data: RequestBitcoinSignatureMessage, source: Node<FastBTCMessage>) => {
        await this.handleMessageFromInitiator(data, source, async (transferBatch) => {
            // This also validates it
            const signedBtcTransaction = await this.bitcoinTransferService.signBitcoinTransaction(transferBatch);
            await this.bitcoinTransferService.updateStoredTransferBatch(transferBatch);

            await source.send('fastbtc:bitcoin-signature-response', {
                transferBatchDto: transferBatch.getDto(),
                signedBtcTransaction,
            });
        });
    }

    onSendingToBitcoin = async (data: RequestBitcoinSignatureMessage, source: Node<FastBTCMessage>) => {
        await this.handleMessageFromInitiator(data, source, async (transferBatch) => {
            await this.transferBatchValidator.validateForSendingToBitcoin(transferBatch);
            await this.bitcoinTransferService.updateStoredTransferBatch(transferBatch);
        });
    }

    onRequestRskMinedSignature = async (data: RequestRSKMinedSignatureMessage, source: Node<FastBTCMessage>) => {
        await this.handleMessageFromInitiator(data, source, async (transferBatch) => {
            // This also validates it
            const {address, signature} =  await this.bitcoinTransferService.signRskMinedUpdate(transferBatch);

            await this.bitcoinTransferService.updateStoredTransferBatch(transferBatch);

            await source.send('fastbtc:rsk-mined-signature-response', {
                transferBatchDto: transferBatch.getDto(),
                address,
                signature
            });
        });
    }

    onTransferBatchComplete = async (data: TransferBatchCompleteMessage, source: Node<FastBTCMessage>) => {
        await this.handleMessageFromInitiator(data, source, async (transferBatch) => {
            await this.transferBatchValidator.validateCompleteTransferBatch(transferBatch);
            await this.bitcoinTransferService.updateStoredTransferBatch(transferBatch);
        });
    }

    onPurgeTransferBatch = async (data: TransferBatchCompleteMessage, source: Node<FastBTCMessage>) => {
        await this.handleMessageFromInitiator(data, source, async (transferBatch) => {
            await this.bitcoinTransferService.purgeTransferBatch(transferBatch);
        });
    }

    private handleMessageFromInitiator = async <T extends TransferBatchMessage>(
        message: T,
        source: Node<FastBTCMessage>,
        callback: (transferBatch: TransferBatch, message: T) => Promise<void>
    ): Promise<void> => {
        if (source.id !== this.networkUtil.getPreferredInitiatorId()) {
            this.logger.warning('Rejecting message from node', source, 'since it is not initiator');
            return;
        }

        let transferBatch = await this.bitcoinTransferService.loadFromDto(message.transferBatchDto);
        if (!transferBatch) {
            this.logger.warning("TransferBatch cannot be loaded because one or more transfers haven't been synchronized");
            return;
        }

        await callback(transferBatch, message);
    }

    onRskSendingSignatureResponse = async (data: RSKSendingSignatureResponseMessage, source: Node<FastBTCMessage>) => {
        await this.handleMessageToInitiator(data, async ({signature, address}) => {
            this.transientInitiatorData.gatheredRskSendingSignaturesAndAddresses.push({ signature, address});
        });
    }

    onBitcoinSignatureResponse = async (data: BitcoinSignatureResponseMessage, source: Node<FastBTCMessage>) => {
        await this.handleMessageToInitiator(data, async ({signedBtcTransaction}) => {
            this.transientInitiatorData.gatheredBitcoinSignatures.push(signedBtcTransaction);
        });
    }

    onRskMinedSignatureResponse = async (data: RSKMinedSignatureResponseMessage, source: Node<FastBTCMessage>) => {
        await this.handleMessageToInitiator(data, async ({signature, address}) => {
            this.transientInitiatorData.gatheredRskMinedSignaturesAndAddresses.push({ signature, address});
        });
    }

    private handleMessageToInitiator = async <T extends TransferBatchMessage>(
        message: T,
        callback: (message: T) => Promise<void>
    ): Promise<void> => {
        if (!this.networkUtil.isThisNodeInitiator()) {
            this.logger.warning('Discarding response message because this node is not the initiator');
            return;
        }
        if (!this.transientInitiatorData.currentTransferBatch) {
            this.logger.warning('Cannot deal with received response because current transfer batch is unknown');
            return;
        }
        this.transientInitiatorData.currentTransferBatch.validateMatchesDto(message.transferBatchDto);
        await callback(message);
    }
}
