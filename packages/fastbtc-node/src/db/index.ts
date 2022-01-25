import {interfaces} from 'inversify';
import Container = interfaces.Container;
import {ConnectionProvider, Connection, createDbConnection, getDbConnection, DBConnection} from './connection';
import {Config} from '../config';
import {DBLogging} from "./dblogging";
import * as scanner from "../rsk/scanner";

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

    container.bind<DBLogging>(DBLogging).toSelf();
}
