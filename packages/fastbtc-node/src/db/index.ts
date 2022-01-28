import {interfaces} from 'inversify';
import {Connection, ConnectionProvider, createDbConnection, DBConnection, getDbConnection} from './connection';
import {Config} from '../config';
import {DBLogging} from "./dblogging";
import Container = interfaces.Container;

export function setupInversify(container: Container) {
    container.bind<ConnectionProvider>(ConnectionProvider).toProvider((context) => {
        const config = context.container.get<Config>(Config);
        return async () => {
            return await createDbConnection(config);
        }
    });

    container.bind<Connection>(DBConnection).toDynamicValue(() => (
        getDbConnection()
    )).inSingletonScope();

    container.bind<DBLogging>(DBLogging).toSelf().inSingletonScope();
}
