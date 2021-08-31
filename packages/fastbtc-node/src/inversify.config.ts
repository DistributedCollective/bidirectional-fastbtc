import {Container} from "inversify";
import {ThrowableWeapon, TYPES, Warrior, Weapon} from "./types";
import {Katana, Ninja, Shuriken} from "./entities";

function bootstrap(): Container {
    const container = new Container();
    container.bind<Warrior>(TYPES.Warrior).to(Ninja);
    container.bind<Weapon>(TYPES.Weapon).to(Katana);
    container.bind<ThrowableWeapon>(TYPES.ThrowableWeapon).to(Shuriken);
    return container;
}


export default bootstrap;
