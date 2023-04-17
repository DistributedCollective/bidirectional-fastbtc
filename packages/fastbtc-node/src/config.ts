import * as fs from "fs";
import {readFileSync} from "fs";
import * as process from "process";
import * as express from "express";
import {parseEther} from "ethers/lib/utils";
import {decryptSecrets} from "./utils/secrets";
import {ReplenisherConfig, ReplenisherSecrets} from './replenisher/config';
import {interfaces} from "inversify";
import Context = interfaces.Context;
import {BigNumber} from 'ethers';

export interface ConfigSecrets {
    dbUrl: string;
    btcRpcPassword: string; // secret
    btcMasterPrivateKey: string; // secret
    btcMasterPublicKeys: string[]; // secret
    rskPrivateKey: string; // secret
    alerterDiscordWebhookUrl: string | undefined; // secret
}

export interface Config {
    knownPeers: string[];
    port: number;
    numRequiredSigners: number; // this can be inferred but maybe it's better to be explicit now
    maxTransfersInBatch: number;
    maxPassedBlocksInBatch: number;
    rskRpcUrl: string;
    rskContractAddress: string;
    rskStartBlock: number;
    rskRequiredConfirmations: number;
    btcNetwork: 'mainnet' | 'testnet' | 'regtest';
    btcRequiredConfirmations: number;
    btcRpcUrl: string;
    btcRpcUsername: string;
    btcKeyDerivationPath: string;
    statsdUrl?: string;
    secrets: () => ConfigSecrets;
    withdrawerContractAddress?: string;
    withdrawerThresholdWei: BigNumber;
    withdrawerMaxAmountWei: BigNumber;
    replenisherConfig: ReplenisherConfig|undefined;
}

const secretConfigKeys: Extract<keyof ConfigSecrets, string>[] = [
    'dbUrl',
    'rskPrivateKey',
    'btcRpcPassword',
    'btcMasterPrivateKey',
    'btcMasterPublicKeys',
    'alerterDiscordWebhookUrl',
];

const defaults = {
    port: 11125,
};

const VALID_BTC_NETWORKS = ['mainnet', 'testnet', 'regtest'];

export const Config = Symbol.for('Config');

class InvalidConfig extends Error {
}

export const envConfigProviderFactory = async (
    filename: string|undefined = process.env.FASTBTC_CONFIG_FILE,
    allowPartial: boolean = false
): Promise<(context: Context) => Config> => {
    const resolve = async () => {
        let env = {} as {[key: string]: string};
        console.log(`Config file set to ${filename}`)
        if (filename) {
            if (! fs.existsSync(filename)) {
                console.error(`... but the config file does not exist!`);
                process.exit(1);
            }
            console.log(`Found encrypted config file at ${filename}`);
            const encryptedConfig = readFileSync(filename, {encoding: 'utf8'});
            env = await new Promise((resolve, reject) => {
                const app = express.default();
                app.use(express.json());
                app.use(express.urlencoded({ extended: true }));
                app.post('/password', (req: any, res: any) => {
                    console.log('config password received');
                    const password = req.body.password;
                    try {
                        const contents = decryptSecrets(Buffer.from(password, 'utf8'), encryptedConfig);
                        resolve(contents);
                        res.json({"success": true});
                        server.close();
                    }
                    catch (e) {
                        res.json({"success": false, "error": `${e}`});
                    }
                });

                const server = app.listen(1337, () => {
                    console.log(`waiting for password to port 1337`)
                });
            });
        }
        else {
            console.log(`Did not find encrypted config file at ${filename}, ` +
             `expecting all arguments to be insecurely in environment`);
        }

        env = {...process.env as {[key: string]: string}, ...env};

        if (!allowPartial) {
            for (let key of [
                'FASTBTC_DB_URL',
                'FASTBTC_NUM_REQUIRED_SIGNERS',
                //'FASTBTC_KNOWN_PEERS', // let's allow it without peers now
                'FASTBTC_RSK_RPC_URL',
                'FASTBTC_RSK_CONTRACT_ADDRESS',
                'FASTBTC_RSK_START_BLOCK',
                'FASTBTC_RSK_PRIVATE_KEY',
                'FASTBTC_BTC_NETWORK',
                'FASTBTC_BTC_RPC_URL',
                'FASTBTC_BTC_MASTER_PRIVATE_KEY',
                'FASTBTC_BTC_MASTER_PUBLIC_KEYS',
            ]) {
                if (!env[key]) {
                    throw new InvalidConfig(`Required env variable ${key} missing`)
                }
            }
        }

        let {
            port,
        } = defaults;
        if (env.FASTBTC_PORT) {
            port = parseInt(env.FASTBTC_PORT);
            if(!port) {
                throw new InvalidConfig(`Invalid port: ${env.FASTBTC_PORT}`);
            }
        }

        const numRequiredSigners = parseInt(env.FASTBTC_NUM_REQUIRED_SIGNERS!);
        if (!numRequiredSigners) {
            throw new InvalidConfig(`numRequiredSigners must be integer > 0 (got ${env.FASTBTC_NUM_REQUIRED_SIGNERS})`);
        }

        if (VALID_BTC_NETWORKS.indexOf(env.FASTBTC_BTC_NETWORK!) === -1) {
            throw new InvalidConfig(
                `Invalid network: ${env.FASTBTC_BTC_NETWORK}, must be one of: ${VALID_BTC_NETWORKS.join(', ')}`
            );
        }

        return {
            numRequiredSigners,
            maxTransfersInBatch: parseInt(env.FASTBTC_MAX_TRANSFERS_IN_BATCH ?? '10'),
            maxPassedBlocksInBatch: parseInt(env.FASTBTC_MAX_PASSED_BLOCKS_IN_BATCH ?? '10'),
            knownPeers: env.FASTBTC_KNOWN_PEERS ? parseKnownPeers(env.FASTBTC_KNOWN_PEERS) : [], // don't require this
            port,
            rskRpcUrl: env.FASTBTC_RSK_RPC_URL!,
            rskContractAddress: env.FASTBTC_RSK_CONTRACT_ADDRESS!,
            rskStartBlock: parseInt(env.FASTBTC_RSK_START_BLOCK!),
            rskRequiredConfirmations: parseInt(env.FASTBTC_RSK_REQUIRED_CONFIRMATIONS ?? '10'),
            btcRequiredConfirmations: parseInt(env.FASTBTC_BTC_REQUIRED_CONFIRMATIONS ?? '3'),
            btcNetwork: env.FASTBTC_BTC_NETWORK! as 'mainnet' | 'testnet' | 'regtest',
            btcRpcUrl: env.FASTBTC_BTC_RPC_URL!,
            btcRpcUsername: env.FASTBTC_BTC_RPC_USERNAME ?? '',
            btcKeyDerivationPath: env.FASTBTC_BTC_KEY_DERIVATION_PATH ?? 'm/0/0/0',
            statsdUrl: env.FASTBTC_STATSD_URL,
            withdrawerContractAddress: env.FASTBTC_WITHDRAWER_CONTRACT_ADDRESS,
            withdrawerThresholdWei: parseEther(env.FASTBTC_WITHDRAWER_THRESHOLD || '10.0'),
            withdrawerMaxAmountWei: parseEther(env.FASTBTC_WITHDRAWER_MAX_AMOUNT || '10.0'),
            secrets: () => (
                {
                    btcRpcPassword: env.FASTBTC_BTC_RPC_PASSWORD ?? '',
                    btcMasterPrivateKey: env.FASTBTC_BTC_MASTER_PRIVATE_KEY!,
                    btcMasterPublicKeys: env.FASTBTC_BTC_MASTER_PUBLIC_KEYS!.split(',').map(x => x.trim()).filter(s => s),
                    rskPrivateKey: env.FASTBTC_RSK_PRIVATE_KEY!,
                    dbUrl: env.FASTBTC_DB_URL!,
                    alerterDiscordWebhookUrl: env.FASTBTC_ALERTER_DISCORD_WEBHOOK_URL,
                }
            ),
            replenisherConfig: getReplenisherConfig(env),
        };
    }

    const config = await resolve();
    return (context) => config;
};

function getReplenisherConfig(env: Record<string, string>): ReplenisherConfig | undefined {
    const secrets: ReplenisherSecrets = {
        rpcPassword: env.FASTBTC_REPLENISHER_RPC_PASSWORD ?? env.FASTBTC_BTC_RPC_PASSWORD,
        masterPublicKeys: (env.FASTBTC_REPLENISHER_MASTER_PUBLIC_KEYS ?? '').split(',').map(s => s.trim()).filter(s => s),
        masterPrivateKey: env.FASTBTC_REPLENISHER_MASTER_PRIVATE_KEY,
    }
    let ret: ReplenisherConfig = {
        btcNetwork: env.FASTBTC_BTC_NETWORK! as 'mainnet' | 'testnet' | 'regtest',
        rpcUrl: env.FASTBTC_REPLENISHER_RPC_URL,
        rpcUserName: env.FASTBTC_REPLENISHER_RPC_USERNAME ?? env.FASTBTC_BTC_RPC_USERNAME,
        keyDerivationPath: env.FASTBTC_REPLENISHER_KEY_DERIVATION_PATH ?? env.FASTBTC_BTC_KEY_DERIVATION_PATH ?? 'm/0/0/0',
        numRequiredSigners: parseInt(env.FASTBTC_REPLENISHER_NUM_REQUIRED_SIGNERS ?? '0'),
        balanceAlertThreshold: parseConfigFloat(env, 'FASTBTC_REPLENISHER_BALANCE_ALERT_THRESHOLD') ?? 5.0,
        secrets: () => secrets,
    };

    const givenKeys: string[] = [];
    const missingKeys: string[] = [];
    for (const [key, value] of [...Object.entries(ret), ...Object.entries(secrets)]) {
        if (key === 'masterPrivateKey') {
            // This one can be left out
            continue;
        }
        if (value && (!Array.isArray(value) || value.length > 0)) {
            givenKeys.push(key);
        } else {
            missingKeys.push(key);
        }
    }

    if (missingKeys.length > 0) {
        if (givenKeys.length > 0) {
            console.warn(
                "Missing the following keys for BTC replenisher: " + missingKeys.join(",") +
                " Even though other keys were given -- disabling it"
            )
        } else {
            console.warn("BTC Replenisher disabled because config not given.")
        }
        return undefined;
    }
    if (!secrets.masterPrivateKey) {
        console.info("BTC Replenisher master private key not given -- this node is not a replenisher.")
    }
    return ret;
}

const parseConfigFloat = (env: Record<string, string>, key: string): number|undefined => {
    return parseConfigNumber(env, key, { allowZero: false, parser: parseFloat })
}

function parseConfigNumber(
    env: Record<string, string>,
    key: string,
    opts: {
        allowZero?: boolean,
        parser?: (raw: string) => number,
    } = {}
): number|undefined {
    const {
        allowZero,
        parser = parseFloat,
    } = opts;
    const raw = env[key];
    if (!raw) {
        return undefined;
    }

    const value = parser(raw);
    if (value === 0) {
        if (!allowZero) {
            console.warn(
                `Got 0 when parsing number from value given for ${key}: ${raw}, but that's not allowed`
            );
            return undefined;
        }
    } else if (!value) {
        console.warn(`Cannot parse number from value given for ${key}: ${raw}; got ${value}`)
        return undefined;
    }
    return value;
}

function parseKnownPeers(raw: string) {
    const knownPeers = raw.split(',').map(s => s.trim()).filter(s => s);
    if(knownPeers.length < 1) {
        throw new InvalidConfig(`At least 1 known peer must be given in FASTBTC_KNOWN_PEERS`);
    }
    for(let s of knownPeers) {
        const parts = s.split(':')
        if(parts.length !== 2) {
            throw new InvalidConfig(`Known peers must be of format "hostname:port" (got "${s}")`);
        }
    }
    return knownPeers;
}

export function getCensoredConfig(config: Config): Record<Extract<keyof Config, string>, any> {
    const ret: any = {};
    for (let [key, value] of Object.entries(config)) {
        if (key != 'secrets') {
            ret[key] = value;
        }
    }

    ret.secrets = `{ ${secretConfigKeys.join(', ')} }`;
    return ret;
}
