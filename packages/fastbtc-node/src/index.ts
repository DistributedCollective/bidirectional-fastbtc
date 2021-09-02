import bootstrap from "./inversify.config";
import {Config} from './config';
import {ConnectionProvider} from './db/connection';
import {EventScanner, Scanner} from './rsk/scanner';

async function main() {
    console.log(`Hello, fastbtc-node here.`);
    let container = bootstrap();

    const config = container.get<Config>(Config);
    console.log('My DB url is', config.dbUrl);

    const connectionProvider = container.get<ConnectionProvider>(ConnectionProvider);
    await connectionProvider();

    const scanner = container.get<EventScanner>(Scanner);
    scanner.scanNewEvents().catch(e => {
        console.error(e);
    });
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
