import https from 'https';

import {IBitcoinNodeWrapper} from './nodewrapper';
import {Network, networks} from "bitcoinjs-lib";
import Logger from '../logger';
import * as http from '../utils/http'

export class BTCFeeEstimator {
    private logger = new Logger('fee-estimator');
    private cachedFeeBtcPerKB: number | undefined = undefined;
    private readonly network: Network;

    constructor(
        private nodeWrapper: IBitcoinNodeWrapper,
    ) {
        this.network = nodeWrapper.network;
    }

    public async estimateFeeSatsPerVB(): Promise<number> {
        let mempoolSpaceFeeSatsPerVB: number | undefined;
        try {
            mempoolSpaceFeeSatsPerVB = await this.fetchFeeSatsPerVBFromMempoolSpace();
        } catch (e) {
            this.logger.exception(
                e,
                'Failed to fetch fee from mempool.space (only a warning, ignored), falling back to bitcoind'
            );
        }

        let bitcoindFeeSatsPerVB: number | undefined;
        try {
            const feeBtcPerKBFromBitcoind = await this.estimateFeeBtcPerKB();
            bitcoindFeeSatsPerVB = feeBtcPerKBFromBitcoind / 1000 * 1e8;
        } catch (e) {
            this.logger.exception(
                e,
                'Failed to fetch fee from bitcoind (only a warning, ignored)'
            );
        }

        // TODO: debug print, we can ditch this
        console.log(`feeSatsPerVB: mempool.space: ${mempoolSpaceFeeSatsPerVB}, bitcoind: ${bitcoindFeeSatsPerVB}`)

        if (mempoolSpaceFeeSatsPerVB !== undefined) {
            return mempoolSpaceFeeSatsPerVB;
        }
        if (bitcoindFeeSatsPerVB !== undefined) {
            return bitcoindFeeSatsPerVB;
        }
        throw new Error(`Failed to fetch fee from both mempool.space and bitcoind`);
    }

    private async fetchFeeSatsPerVBFromMempoolSpace(): Promise<number> {
        let url: string;
        if (this.network === networks.testnet) {
            url = 'https://mempool.space/testnet/api/v1/fees/recommended';
        } else {
            // might as well use the real fee for regtest *__*
            url = 'https://mempool.space/api/v1/fees/recommended';
        }
        const response = await http.getJson(url);
        const ret = response.fastestFee;
        if (typeof ret !== 'number') {
            throw new Error(`Unexpected response from mempool.space: ${JSON.stringify(response)}`);
        }
        return ret;
    }

    public async estimateFeeBtcPerKB(): Promise<number> {
        // We aim to get a fee that will get us into the next block, but it doesn't always work.
        let estimateRawFeeOutput = await this.nodeWrapper.call('estimaterawfee', [1]);
        let feeBtcPerKB = estimateRawFeeOutput.short.feerate;
        if (typeof feeBtcPerKB === 'number') {
            // It worked -- yay. Cache and return it.
            this.cachedFeeBtcPerKB = feeBtcPerKB;
            return feeBtcPerKB;
        } else if (this.network === networks.regtest) {
            // estimateRawFee doesn't work on regtest
            return 10 / 1e8 * 1000;
        } else {
            // It didn't work. We cannot always estimate the fee for two blocks.
            // Here we will fall back on the higher of the cached fee and the estimated fee for two blocks
            const response1 = JSON.stringify(estimateRawFeeOutput);
            this.logger.warn(
                `estimaterawfee 1 failed with response ${response1} -- falling back to estimaterawfee 2`
            );

            let estimateRawFeeIn2BlocksOutput = await this.nodeWrapper.call('estimaterawfee', [2]);
            let feeIn2BlocksBtcPerKB = estimateRawFeeIn2BlocksOutput.short.feerate;
            if (typeof feeIn2BlocksBtcPerKB === 'number') {
                if (this.cachedFeeBtcPerKB) {  // we could compare to undefined, but 0 and null don't seem right either
                    return Math.max(this.cachedFeeBtcPerKB, feeIn2BlocksBtcPerKB);
                } else {
                    // If we don't have the cached fee, reluctantly use the 2 blocks fee (and cache it)
                    this.cachedFeeBtcPerKB = feeIn2BlocksBtcPerKB;
                    return feeIn2BlocksBtcPerKB;
                }
            } else {
                const response2 = JSON.stringify(estimateRawFeeIn2BlocksOutput);
                throw new Error(
                    `Unable to deduce gas fee, got ${response1} for response for estimaterawfee1 ` +
                    `and ${response2} for response from estimaterawfee 2 from the btc node`
                );
            }
        }
    }
}
