export interface Config {
    dbUrl: string;
    rskRpcUrl: string;
    rskContractAddress: string;
    rskStartBlock: number;
    rskRequiredConfirmations: number;
}
export const Config = Symbol.for('Config');

export const createEnvConfig = (env = process.env): Config => {
    for(let key of [
        'FASTBTC_DB_URL',
        'FASTBTC_RSK_RPC_URL',
        'FASTBTC_RSK_CONTRACT_ADDRESS',
        'FASTBTC_RSK_START_BLOCK',
    ]) {
        if(!env[key]) {
            throw new Error(`Required env variable ${key} missing`)
        }
    }
    return {
        dbUrl: env.FASTBTC_DB_URL!,
        rskRpcUrl: env.FASTBTC_RSK_RPC_URL!,
        rskContractAddress: env.FASTBTC_RSK_CONTRACT_ADDRESS!,
        rskStartBlock: parseInt(env.FASTBTC_RSK_START_BLOCK!),
        rskRequiredConfirmations: parseInt(env.FASTBTC_RSK_REQUIRED_CONFIRMATIONS ?? '5'),
    }
};
