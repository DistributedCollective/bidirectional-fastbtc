import {interfaces} from 'inversify';
import Container = interfaces.Container;
import {ConnectionProvider, createDbConnection} from './connection';
import {Config} from '../config';

export function setupInversify(container: Container) {
    container.bind<ConnectionProvider>(ConnectionProvider).toProvider((context) => {
        const config = context.container.get<Config>(Config);
        return async () => {
            // TODO: should we close this also :D
            return await createDbConnection(config);
        }
    });
}
