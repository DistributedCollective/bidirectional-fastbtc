import {Container} from "inversify";
import {ThrowableWeapon, TYPES, Warrior, Weapon} from "./types";
import {Katana, Ninja, Shuriken} from "./entities";
import {Config, createEnvConfig} from './config';
import * as db from './db';
import * as rsk from './rsk';

function bootstrap(): Container {
    const container = new Container();
    container.bind<Warrior>(TYPES.Warrior).to(Ninja);
    container.bind<Weapon>(TYPES.Weapon).to(Katana);
    container.bind<ThrowableWeapon>(TYPES.ThrowableWeapon).to(Shuriken);

    container.bind<Config>(Config).toConstantValue(
        createEnvConfig()
    );

    db.setupInversify(container);
    rsk.setupInversify(container);
    return container;
}

export default bootstrap;
