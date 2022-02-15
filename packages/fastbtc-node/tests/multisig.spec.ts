import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { networks} from 'bitcoinjs-lib';
import { BitcoinMultisig, BitcoinMultisigConfig } from '../src/btc/multisig';
import { IBitcoinNodeWrapper } from '../src/btc/nodewrapper';
import {ConfigSecrets} from '../src/config';

describe('BitcoinMultisig', () => {
    describe('validateAddress', () => {
        let mainnetMultisig: BitcoinMultisig;
        let testnetMultisig: BitcoinMultisig;

        beforeEach(() => {
            const fauxBaseConfig = {
                'btcRpcUrl': '',
                'btcRpcUsername': '',
                'btcKeyDerivationPath': '0/0',
                'numRequiredSigners': 1,
            }
            const fauxBaseSecrets: Pick<ConfigSecrets, 'dbUrl' | 'btcRpcPassword' | 'rskPrivateKey'> = {
                'dbUrl': '',
                'btcRpcPassword': '',
                'rskPrivateKey': '',
            }
            // NOTE: the keys here are generated from mnemonic "test test foo bar". They are supposed to be here --
            // do not send actual funds to them.
            const fauxMainnetConfig : BitcoinMultisigConfig = {
                ...fauxBaseConfig,
                'btcNetwork': 'mainnet',
                secrets: () => ({
                    ...fauxBaseSecrets,
                    'btcMasterPrivateKey': 'xprv9tviSb99cQK1ZSZBUJV3YMsD1eXujJr8P6FH8JB2WZF2TgZSMSfpZjjKbsp5sEnX53ufPE8QjQwCuNaZ8hnZm9iWLxoampf8x8xVzZwd27N',
                    'btcMasterPublicKeys': [
                        'xpub67v4r6g3SmsJmvdeaL23uVowZgNQ8mZykKAsvgae4tn1LUtatyz57Y3oT9jwxtmDiDSXPFvqDynFiLfpigLbDFsV5ny3YsEeuyhn1511AoQ'
                    ],
                }),
            };
            const fauxTestnetConfig : BitcoinMultisigConfig = {
                ...fauxBaseConfig,
                'btcNetwork': 'testnet',
                secrets: () => ({
                    ...fauxBaseSecrets,
                    'btcMasterPrivateKey': 'tprv8bbfDvTV1g96AFni8sLYi1VCKmx7xpt8ieAPzibUzXjWFHJXLp1a5V6mX3yjscAqSVSSPKkAtmX1NE8JFv8WaCz6sc1tSBPBsEhvSHE7S3b',
                    'btcMasterPublicKeys': [
                        'tpubD8HhNLVjA3pm3ipW2X197R9JtoU48A53HwmBHEdnQoXu5mZHyCqAFyidhBpjVPiTW7yRzqShm5cJQXAS7YBq6hKn9PiMEPttVwJBm7FpjfF'
                    ],
                }),
            };
            const fauxMainnetNodeWrapper: IBitcoinNodeWrapper = {
                network: networks.bitcoin,
                call: async (method: string, params: any): Promise<any> => ({}),
                getLastBlock: async (): Promise<number|undefined> => 1,
            };
            mainnetMultisig = new BitcoinMultisig(
                fauxMainnetConfig,
                fauxMainnetNodeWrapper
            );
            testnetMultisig = new BitcoinMultisig(
                fauxTestnetConfig,
                {
                    ...fauxMainnetNodeWrapper,
                    network: networks.testnet,
                }
            );

        });

        it('validates bech32 addresses', () => {
            expect(mainnetMultisig.validateAddress("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4")).to.be.true;
            // bech32 must not contain 1, b, i, o
            expect(mainnetMultisig.validateAddress("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t1")).to.be.false;
            expect(mainnetMultisig.validateAddress("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3tb")).to.be.false;
            expect(mainnetMultisig.validateAddress("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3ti")).to.be.false;
            expect(mainnetMultisig.validateAddress("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3to")).to.be.false;

            // wrong character w.r.t. prefix
            expect(mainnetMultisig.validateAddress("bc1pw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3to")).to.be.false;

            // we don't allow upper case
            expect(mainnetMultisig.validateAddress("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4".toUpperCase())).to.be.false;
        });

        it("validates legacy addresses", async () => {
            // must start with 1 or 3
            expect(mainnetMultisig.validateAddress("1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2")).to.be.true;
            expect(mainnetMultisig.validateAddress("2BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2")).to.be.false;
            expect(mainnetMultisig.validateAddress("3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy")).to.be.true;
            expect(mainnetMultisig.validateAddress("ABvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2")).to.be.false;

            // cannot contain 0, O, I, or l
            expect(mainnetMultisig.validateAddress("10vBMSEYstWetqTFn5Au4m4GFg7xJaNVN2")).to.be.false;
            expect(mainnetMultisig.validateAddress("1OvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2")).to.be.false;
            expect(mainnetMultisig.validateAddress("1IvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2")).to.be.false;
            expect(mainnetMultisig.validateAddress("1lvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2")).to.be.false;

            // cannot contain special characters
            expect(mainnetMultisig.validateAddress("1BvBMSEYst:etqTFn5Au4m4GFg7xJaNVN2")).to.be.false;

            // These are just random ones that are not supposed to have a matching script
            expect(mainnetMultisig.validateAddress("1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN3")).to.be.false;
            expect(mainnetMultisig.validateAddress("1BvBMSEYstWetqTFn5Au4m4GFg7")).to.be.false;
        });

        it("validates taproot addresses", async () => {
            // Currently we don't have support for these
            expect(mainnetMultisig.validateAddress("bc1pmzfrwwndsqmk5yh69yjr5lfgfg4ev8c0tsc06e")).to.be.false;
        });

        it("validates a couple of testnet addresses", async () => {
            expect(testnetMultisig.validateAddress("mh6PShV3LGPXw2r7VfEeLm1a7UQCftutcG")).to.be.true;
            expect(testnetMultisig.validateAddress("mh6PShV3LGPXw2r7VfEeLm1a7UQCftutcH")).to.be.false;

            expect(testnetMultisig.validateAddress("2MuDiRVgQ8WUX6or7gr9Cf72szzGrUzFhCR")).to.be.true;
            expect(testnetMultisig.validateAddress("2MuDiRVgQ8WUX6or7gr9Cf72szzGrUzFhCRS")).to.be.false;

            expect(testnetMultisig.validateAddress("tb1q8804ep5pc348h8gwgg9tmtxghp7scehcngyn9uz5ndhq8dlnmjxs2mqk40")).to.be.true;
            expect(testnetMultisig.validateAddress("tb1qylpt0nezv8g52cpuk2ngp329ma32kwuk3u8h6j")).to.be.true;

            expect(testnetMultisig.validateAddress("n36jhMj8FQD2EqBXUztxyHXr65RpX89fdM")).to.be.true;
            expect(testnetMultisig.validateAddress("n36jhMj8FQD2EqBXUztxyHXr65RpX89fd")).to.be.false;

            // No taproot support
            expect(testnetMultisig.validateAddress("tb1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqp3mvzv")).to.be.false;
        });
    })
});
