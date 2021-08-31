import bootstrap from "./inversify.config";
import {TYPES, Warrior} from "./types";

function main(foo: number) {
    console.log(`Hello ${foo + 1}`);
}

export default main;

if (require.main == module) {
    let container = bootstrap();
    const ninja = container.get<Warrior>(TYPES.Warrior);
    console.log(ninja.fight());
    main(1336);
}
