export interface Config {
    dbUrl: string;
}
export const Config = Symbol.for('Config');

export const createEnvConfig = (env = process.env): Config => {
    if(!env.FASTBTC_DB_URL) {
        throw new Error('Required env variable FASTBTC_DB_URL missing')
    }
    return {
        dbUrl: env.FASTBTC_DB_URL,
    }
};
