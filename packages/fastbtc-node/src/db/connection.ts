import 'reflect-metadata';
import {
    createConnection,
    Connection
} from 'typeorm';
import { Transfer } from './models';
import {Config} from '../config';

const DB_ENTITIES = [
    Transfer,
];

export const createDbConnection = async (config: Config): Promise<Connection> => {
    return await createConnection({
        type: "postgres",
        url: config.dbUrl,
        entities: DB_ENTITIES,

        // TODO: these should probs be false in prod!
        synchronize: true,
        logging: true,
    });
}
export type ConnectionProvider = () => Promise<Connection>;
export const ConnectionProvider = Symbol.for('ConnectionProvider');
export { Connection };
