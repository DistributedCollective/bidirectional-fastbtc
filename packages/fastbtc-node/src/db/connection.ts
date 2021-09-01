import 'reflect-metadata';
import {
    createConnection,
    Connection
} from 'typeorm';
import { ALL_MODELS } from './models';
import {Config} from '../config';

export const createDbConnection = async (config: Config): Promise<Connection> => {
    console.log('Creating db connection');
    return await createConnection({
        type: "postgres",
        url: config.dbUrl,
        entities: ALL_MODELS,

        logging: false,

        // TODO: should be false in prod! and have real migrations
        synchronize: true,
    });
}
export type ConnectionProvider = () => Promise<Connection>;
export const ConnectionProvider = Symbol.for('ConnectionProvider');
export { Connection };
