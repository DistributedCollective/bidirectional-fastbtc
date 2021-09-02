import bootstrap from "./inversify.config";
import {Config} from './config';
import {ConnectionProvider} from './db/connection';
import {EventScanner, Scanner} from './rsk/scanner';
import {Transfer} from './db/models';

async function main() {
    console.log(`Hello, fastbtc-node here.`);
    let container = bootstrap();

    const config = container.get<Config>(Config);
    console.log('My DB url is', config.dbUrl);

    const connectionProvider = container.get<ConnectionProvider>(ConnectionProvider);
    const connection = await connectionProvider();

    const existingTransfers = await connection.getRepository(Transfer).find();
    console.log('Existing transfers')
    console.log(existingTransfers);

    const scanner = container.get<EventScanner>(Scanner);
    const newTransfers = await scanner.scanNewEvents();
    console.log('New transfers')
    console.log(newTransfers);
}

export default main;

if (require.main == module) {
    main().then(() => {
        console.log('All done');
        process.exit(0);
    }).catch(e => {
        console.error(e);
        process.exit(1);
    });
}
