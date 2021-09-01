import bootstrap from "./inversify.config";
import {TYPES, Warrior} from "./types";
import {Config} from './config';

function main(foo: number) {
    console.log(`Hello ${foo + 1}`);
}

export default main;

if (require.main == module) {
    let container = bootstrap();
    const ninja = container.get<Warrior>(TYPES.Warrior);
    console.log(ninja.fight());
    const config = container.get<Config>(Config);
    console.log('My db url is', config.dbUrl);
    main(1336);
}
