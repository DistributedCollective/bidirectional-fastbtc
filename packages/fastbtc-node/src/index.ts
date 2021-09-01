import bootstrap from "./inversify.config";
import {TYPES, Warrior} from "./types";
import {Config} from './config';
import {ConnectionProvider} from './db/connection';
import {Transfer} from './db/models';

function main() {
    console.log(`Hello, fastbtc-node here.`);
    let container = bootstrap();

    console.log('Let\'s do some ninja fighting')
    const ninja = container.get<Warrior>(TYPES.Warrior);
    console.log(ninja.fight());

    const config = container.get<Config>(Config);
    console.log('My DB url is', config.dbUrl);

    const connectionProvider = container.get<ConnectionProvider>(ConnectionProvider);
    connectionProvider().then(async (connection) => {
        console.log('Connection created');
        const repository = connection.getRepository(Transfer);
        const allTransfers = await repository.find();
        console.log('Transfers', allTransfers);
    }).catch((e) => {
        console.error(e);
    })
}

export default main;

if (require.main == module) {
    main();
}
