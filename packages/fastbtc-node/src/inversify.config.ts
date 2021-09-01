import {Container, interfaces} from "inversify";
import {ThrowableWeapon, TYPES, Warrior, Weapon} from "./types";
import {Katana, Ninja, Shuriken} from "./entities";
import { Config, createEnvConfig } from './config';
import { Connection, createDbConnection, ConnectionProvider} from './db/connection';

function bootstrap(): Container {
    const container = new Container();
    container.bind<Warrior>(TYPES.Warrior).to(Ninja);
    container.bind<Weapon>(TYPES.Weapon).to(Katana);
    container.bind<ThrowableWeapon>(TYPES.ThrowableWeapon).to(Shuriken);
    container.bind<Config>(Config).toConstantValue(
        createEnvConfig()
    );
    container.bind<ConnectionProvider>(ConnectionProvider).toProvider((context) => {
        const config = context.container.get<Config>(Config);
        return async () => {
            return await createDbConnection(config);
        }
    })
    return container;
}

export default bootstrap;
