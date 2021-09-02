import {interfaces} from 'inversify';
import Container = interfaces.Container;
import {ConnectionProvider, Connection, createDbConnection, getDbConnection, DBConnection} from './connection';
import {Config} from '../config';
import {getConnection} from 'typeorm';

export function setupInversify(container: Container) {
    container.bind<ConnectionProvider>(ConnectionProvider).toProvider((context) => {
        const config = context.container.get<Config>(Config);
        return async () => {
            // TODO: should we close this also :D
            return await createDbConnection(config);
        }
    });

    // TODO: not sure if allowing collection like this is a good idea
    container.bind<Connection>(DBConnection).toDynamicValue(() => (
        getDbConnection()
    ));
}
