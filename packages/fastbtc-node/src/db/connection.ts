import 'reflect-metadata';
import {
    createConnection,
    Connection, getConnection,
} from 'typeorm';
import { ALL_MODELS } from './models';
import {Config} from '../config';
import {SnakeNamingStrategy} from "typeorm-naming-strategies";

export const createDbConnection = async (config: Config): Promise<Connection> => {
    console.log('Creating db connection');
    return await createConnection();
}
export type ConnectionProvider = () => Promise<Connection>;
export const ConnectionProvider = Symbol.for('ConnectionProvider');

export const DBConnection = Symbol.for('DBConnection');
export const getDbConnection = getConnection;

export { Connection };
