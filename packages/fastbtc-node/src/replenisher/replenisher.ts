import {BitcoinMultisig, PartiallySignedBitcoinTransaction} from '../btc/multisig';
import {MessageUnion, Network} from 'ataraxia';
import Logger from '../logger';
import {ReplenisherMultisig} from './replenishermultisig';
import {ReplenisherConfig} from './config';
import {setExtend, setIntersection} from '../utils/sets';
import {sleep} from '../utils';
import {Alerter} from '../alerts/types';

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
    checkBalances(): Promise<void>
}

export const BitcoinReplenisher = Symbol.for('BitcoinReplenisher')


export class ActualBitcoinReplenisher implements BitcoinReplenisher {
    private logger = new Logger('replenisher');
    private unsignedReplenishPsbt: PartiallySignedBitcoinTransaction|null = null;
    private gatheredPsbts: PartiallySignedBitcoinTransaction[] = [];
    private numRequiredSigners: number;
    private isReplenisher: boolean;

    // Limit replenishments to N per period as a security measure
    private readonly maxReplenishmentsDuringPeriod: number = 3;
    private readonly replenishPeriod: number = 24 * 60 * 60 * 1000; // 1 day
    // Keeping all replenishment periods in a record will in theory leak memory,
    // but replenishments should be rare enough for this not to matter
    private timesReplenishedPerPeriod: Record<number, number> = {};
    // If the replenisher multisig balance drops below this (in BTC), we'll send an alert
    private balanceAlertThreshold: number;
    private readonly balanceAlertIntervalSeconds = 6 * 60 * 60; // 6 hours

    constructor(
        config: ReplenisherConfig,
        private bitcoinMultisig: BitcoinMultisig,
        private network: Network<BitcoinReplenisherMessage>,
        private replenisherMultisig: ReplenisherMultisig,
        private alerter: Alerter,
    ) {
        this.numRequiredSigners = config.numRequiredSigners;
        // It's possible that this node is not a replenisher though it can be the initiator
        this.isReplenisher = !!config.secrets().masterPrivateKey;
        this.balanceAlertThreshold = config.balanceAlertThreshold;
        network.onMessage(this.onMessage);
    }

    async checkBalances() {
        // This is now separated from handleReplenisherIteration because only one node is monitoring the balances
        // and that node is not necessary the initiator (which is the one that calls handleReplenisherIteration)
        // Alternatively we could conf each node with the monitoring config and do this in handleReplenisherIteration
        const balance = await this.replenisherMultisig.getTotalAvailableBalance({
            logToStatsd: true,
        });
        this.logger.debug(`Total available balance (multisig + replenisher): ${balance} BTC`);
        if (balance < this.balanceAlertThreshold) {
            this.logger.warning(
                `Total available balance (multisig + replenisher) ${balance} BTC is below the alert threshold ${this.balanceAlertThreshold} BTC`,
            )
            this.alerter.throttledAlert(
                'replenisher.balance',
                `Total available balance (multisig + replenisher) for bidi-FastBTC is low (${balance} BTC), ` +
                `please replenish it as soon as possible`,
                this.balanceAlertIntervalSeconds,
            );
        }
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
        try {
            await this.replenisherMultisig.submitReplenishTransaction(combinedPsbt);
        } catch (e: any) {
            // Sometimes we get 'bad-txns-inputs-missingorspent', which probably indicates that we planned to use
            // utxos in the replenish psbt that got used before we managed to send the tx.
            // In this case, let's try to redo the replenish psbt.
            if (e.message === 'bad-txns-inputs-missingorspent') {
                this.logger.exception(
                    e,
                    '\'bad-txns-inputs-missingorspent\' replenisher error -- recreating replenish tx'
                );
                this.unsignedReplenishPsbt = null;
                this.gatheredPsbts = [];
                return;
            } else {
                // catch this upstream
                throw e;
            }
        }
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

                    // We previously got errors where the signing would take too long (with 1000 inputs),
                    // hence we have some extra logging here.
                    console.log("Signing replenish PSBT");
                    const timestampBefore = +new Date();
                    const psbt = await this.replenisherMultisig.signReplenishPsbt(originalPsbt);
                    console.log("Signing replenish PSBT took %s s", ((+new Date()) - timestampBefore) / 1000);
                    await message.source.send('fastbtc:replenish-signature-response', {
                        psbt,
                    })
                    console.log("Replenisher response sent");
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

    async checkBalances() {
        this.logger.warning('Replenisher config missing -- cannot check balances');
    }
}
