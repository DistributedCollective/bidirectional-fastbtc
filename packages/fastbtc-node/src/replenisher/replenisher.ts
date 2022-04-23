import {BitcoinMultisig, PartiallySignedBitcoinTransaction} from '../btc/multisig';
import {MessageUnion, Network} from 'ataraxia';
import Logger from '../logger';
import {ReplenisherMultisig} from './replenishermultisig';
import {ReplenisherConfig} from './config';
import {setExtend, setIntersection} from '../utils/sets';
import {sleep} from '../utils';

interface RequestReplenishSignatureMessage {
    psbt: PartiallySignedBitcoinTransaction;
    periodIndex: number;
    timesReplenishedDuringPeriod: number;
}
interface ReplenishSignatureResponseMessage {
    psbt: PartiallySignedBitcoinTransaction;
}
interface BitcoinReplenisherMessage {
    'fastbtc:request-replenish-signature': RequestReplenishSignatureMessage,
    'fastbtc:replenish-signature-response': ReplenishSignatureResponseMessage,
}

export interface BitcoinReplenisher {
    handleReplenisherIteration(): Promise<void>;
}
export const BitcoinReplenisher = Symbol.for('BitcoinReplenisher')


export class ActualBitcoinReplenisher implements BitcoinReplenisher {
    private logger = new Logger('replenisher');
    private unsignedReplenishPsbt: PartiallySignedBitcoinTransaction|null = null;
    private gatheredPsbts: PartiallySignedBitcoinTransaction[] = [];
    private numRequiredSigners: number;
    private isReplenisher: boolean;

    // Limit replenishments to N per period as a security measure
    private readonly maxReplenishmentsDuringPeriod: number = 2;
    private readonly replenishPeriod: number = 24 * 60 * 60 * 1000; // 1 day
    // Keeping all replenishment periods in a record will in theory leak memory,
    // but replenishments should be rare enough for this not to matter
    private timesReplenishedPerPeriod: Record<number, number> = {};

    constructor(
        config: ReplenisherConfig,
        private bitcoinMultisig: BitcoinMultisig,
        private network: Network<BitcoinReplenisherMessage>,
        private replenisherMultisig: ReplenisherMultisig,
    ) {
        this.numRequiredSigners = config.numRequiredSigners;
        // It's possible that this node is not a replenisher though it can be the initiator
        this.isReplenisher = !!config.secrets().masterPrivateKey;
        if (config.maxReplenishmentsDuringPeriod !== undefined) {
            this.maxReplenishmentsDuringPeriod = config.maxReplenishmentsDuringPeriod;
        }
        if (config.replenishPeriod !== undefined) {
            this.replenishPeriod = config.replenishPeriod;
        }
        network.onMessage(this.onMessage);
    }

    async handleReplenisherIteration() {
        if (!await this.replenisherMultisig.shouldReplenish()) {
            this.logger.throttledInfo(
                'No replenishing is in order -- not doing anything ',
                10 * 60
            );
            return;
        }

        const periodIndex = Math.floor(+new Date() / this.replenishPeriod);
        let timesReplenishedDuringPeriod = this.timesReplenishedPerPeriod[periodIndex] ?? 0
        const periodStart = new Date(periodIndex * this.replenishPeriod);
        const periodEnd = new Date(+periodStart + this.replenishPeriod);
        const replenishInfo = (
            `(replenished ${timesReplenishedDuringPeriod} times during period ` +
            `${periodStart.toJSON()}-${periodEnd.toJSON()})`
        )

        if (timesReplenishedDuringPeriod >= this.maxReplenishmentsDuringPeriod) {
            this.logger.warning(
                `Max replenishments exhausted, must wait until next period ` +
                `for further replenishments. ${replenishInfo}`
            );
            return;
        }

        this.logger.info(
            'Handling replenisher iteration ' + replenishInfo,
        );

        if (!this.unsignedReplenishPsbt) {
            this.unsignedReplenishPsbt = await this.replenisherMultisig.createReplenishPsbt();
            this.gatheredPsbts = [];
            await this.requestSignatures({
                periodIndex,
                timesReplenishedDuringPeriod,
            });
            return;
        }

        const combinedPsbt = await this.gatherPsbts();
        if (!combinedPsbt) {
            this.logger.error('Could not get gathered psbt');
            return;
        }

        if (combinedPsbt.signedPublicKeys.length < this.numRequiredSigners) {
            this.logger.info('Not enough replenish signatures');
            await this.requestSignatures({
                periodIndex,
                timesReplenishedDuringPeriod,
            });
            return;
        }

        this.logger.info('Sending replenish transaction to the blockchain');
        await this.replenisherMultisig.submitReplenishTransaction(combinedPsbt);
        this.logger.info('Replenish transaction sent, waiting for confirmation');
        await this.waitForTransaction(combinedPsbt);
        this.logger.info('Replenish transaction confirmed successfully');

        // load this value again to be extra safe with race conditions
        timesReplenishedDuringPeriod = this.timesReplenishedPerPeriod[periodIndex] ?? 0
        this.timesReplenishedPerPeriod[periodIndex] = timesReplenishedDuringPeriod + 1;
        this.unsignedReplenishPsbt = null;
        this.gatheredPsbts = [];
    }

    private onMessage = async (message: MessageUnion<BitcoinReplenisherMessage>) => {
        const logMessage = () => {
            //let dataRepr;
            //try {
            //    dataRepr = JSON.stringify(message.data);
            //} catch(e) {
            //    this.logger.exception(e, 'Error creating replenisher message repr (ignored)')
            //    dataRepr = '(failed to create repr)'
            //}
            this.logger.info(
                'Received replenisher message, from: %s, type: %s, data: %s',
                message.source.id,
                message.type,
                '(message data redacted)',
            );
        }
        try {
            switch (message.type) {
                case 'fastbtc:request-replenish-signature':
                    logMessage();
                    if (!this.isReplenisher) {
                        // Don't bother signing if we're not a replenisher
                        return;
                    }

                    const {
                        psbt: originalPsbt,
                        periodIndex,
                        timesReplenishedDuringPeriod
                    } = message.data;
                    // We just trust the initiator for these limits
                    if (timesReplenishedDuringPeriod !== 0) {  // don't store 0 needlessly
                        this.timesReplenishedPerPeriod[periodIndex] = timesReplenishedDuringPeriod;
                    }

                    console.log("Signing replenish PSBT");
                    const psbt = await this.replenisherMultisig.signReplenishPsbt(originalPsbt);
                    console.log("Signed replenish PSBT, sending response");
                    await message.source.send('fastbtc:replenish-signature-response', {
                        psbt,
                    })
                    console.log("Response sent");
                    return;
                case 'fastbtc:replenish-signature-response':
                    logMessage();
                    this.gatheredPsbts.push(message.data.psbt);
                    return;
            }
        } catch(err) {
            this.logger.exception(err, 'Error in replenisher onMessage');
        }
    }

    private async requestSignatures({
        periodIndex,
        timesReplenishedDuringPeriod
    }: {
        periodIndex: number,
        timesReplenishedDuringPeriod: number
    }) {
        if (!this.unsignedReplenishPsbt) {
            this.logger.warning('No unsignedReplenishPsbt, cannot request signatures');
            return;
        }
        await this.network.broadcast('fastbtc:request-replenish-signature', {
            psbt: this.unsignedReplenishPsbt,
            periodIndex,
            timesReplenishedDuringPeriod,
        });
    }

    private async gatherPsbts(): Promise<PartiallySignedBitcoinTransaction|undefined> {
        if (!this.unsignedReplenishPsbt) {
            return;
        }
        const gatheredPsbts = [...this.gatheredPsbts];
        this.gatheredPsbts = [];

        const validPsbts: PartiallySignedBitcoinTransaction[] = [];
        const seenPublicKeys = new Set<string>();

        if (!seenPublicKeys.has(this.replenisherMultisig.getThisNodePublicKey())) {
            const thisNodePsbt = await this.replenisherMultisig.signReplenishPsbt(this.unsignedReplenishPsbt);
            validPsbts.push(thisNodePsbt);
            setExtend(seenPublicKeys, thisNodePsbt.signedPublicKeys);
        }

        for (const psbt of gatheredPsbts) {
            if (psbt.signedPublicKeys.length === 0) {
                this.logger.info('empty psbt, skipping');
                continue;
            }

            const seenIntersection = setIntersection(seenPublicKeys, new Set(psbt.signedPublicKeys));
            if (seenIntersection.size) {
                this.logger.info(`public keys ${[...seenIntersection]} have already signed`);
                continue;
            }

            setExtend(seenPublicKeys, psbt.signedPublicKeys);

            validPsbts.push(psbt);
            if (seenPublicKeys.size === this.numRequiredSigners) {
                break
            }
        }

        if (validPsbts.length > 0) {
            return await this.replenisherMultisig.combineReplenishPsbt([this.unsignedReplenishPsbt, ...validPsbts]);
        }
    }

    private async waitForTransaction(psbt: PartiallySignedBitcoinTransaction) {
        const requiredConfirmations = 1;
        const maxIterations = 200;
        const avgBlockTimeMs = 10 * 60 * 1000;
        const overheadMultiplier = 2;
        const sleepTimeMs = Math.round((avgBlockTimeMs * requiredConfirmations * overheadMultiplier) / maxIterations);
        this.logger.info(`Waiting for ${requiredConfirmations} confirmations`);
        for (let i = 0; i < maxIterations; i++) {
            const chainTx = await this.replenisherMultisig.getBitcoinTransaction(psbt);
            const confirmations = chainTx ? chainTx.confirmations : 0;
            if (confirmations >= requiredConfirmations) {
                break;
            }
            await sleep(sleepTimeMs);
        }
    }
}

export class NullBitcoinReplenisher implements BitcoinReplenisher {
    private logger = new Logger('replenisher');

    async handleReplenisherIteration() {
        this.logger.warning('Replenisher config missing -- not handling iteration');
    }
}
