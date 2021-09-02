export interface Config {
    dbUrl: string;
    rskRpcUrl: string;
    rskContractAddress: string;
    rskStartBlock: number;
    rskRequiredConfirmations: number;
    knownPeers: string[];
    port: number;
}
const defaults = {
    port: 11125,
}
export const Config = Symbol.for('Config');

class InvalidConfig extends Error {
}

export const createEnvConfig = (env = process.env): Config => {
    for(let key of [
        'FASTBTC_DB_URL',
        'FASTBTC_RSK_RPC_URL',
        'FASTBTC_RSK_CONTRACT_ADDRESS',
        'FASTBTC_RSK_START_BLOCK',
        'FASTBTC_KNOWN_PEERS',
    ]) {
        if(!env[key]) {
            throw new InvalidConfig(`Required env variable ${key} missing`)
        }
    }

    let {
        port
    } = defaults;
    if (env.FASTBTC_PORT) {
        port = parseInt(env.FASTBTC_PORT);
        if(!port) {
            throw new InvalidConfig(`Invalid port: ${env.FASTBTC_PORT}`);
        }
    }
    return {
        dbUrl: env.FASTBTC_DB_URL!,
        rskRpcUrl: env.FASTBTC_RSK_RPC_URL!,
        rskContractAddress: env.FASTBTC_RSK_CONTRACT_ADDRESS!,
        rskStartBlock: parseInt(env.FASTBTC_RSK_START_BLOCK!),
        rskRequiredConfirmations: parseInt(env.FASTBTC_RSK_REQUIRED_CONFIRMATIONS ?? '5'),
        knownPeers: parseKnownPeers(env.FASTBTC_KNOWN_PEERS!),
        port,
    }
};

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
