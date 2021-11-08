import {interfaces} from 'inversify';
import Container = interfaces.Container;
import {ConnectionProvider, Connection, createDbConnection, getDbConnection, DBConnection} from './connection';
import {Config} from '../config';
import {DBLogging} from "./dblogging";

export function setupInversify(container: Container) {
    container.bind<ConnectionProvider>(ConnectionProvider).toProvider((context) => {
        const config = context.container.get<Config>(Config);
        return async () => {
            return await createDbConnection(config);
        }
    });

    container.bind<Connection>(DBConnection).toDynamicValue(() => (
        getDbConnection()
    ));

    container.bind<DBLogging>(DBLogging).toProvider( (context) => {
        return async () => {
            const conn = await context.container.get<Connection>(DBConnection);
            return new DBLogging(conn);
        }
    });
}
