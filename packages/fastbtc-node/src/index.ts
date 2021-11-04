import Logger from './logger';
import bootstrap from "./inversify.config";
import {Config, getCensoredConfig} from './config';
import {FastBTCNode} from './main';
import {ConnectionProvider} from './db/connection';

const rootLogger = new Logger();

async function main() {
    rootLogger.enable();

    rootLogger.log(`Hello, fastbtc-node here.`);
    let container = bootstrap();

    const config = container.get<Config>(Config);
    rootLogger.log('My config is', getCensoredConfig(config));

    // TODO: this is silly, but we have to init the connection. Architect this thing better
    const dbConnection = await container.get<ConnectionProvider>(ConnectionProvider)();

    try {
        const node = container.get<FastBTCNode>(FastBTCNode);
        await node.run();
    } finally {
        await dbConnection.close();
    }
}

export default main;

if (require.main == module) {
    main().then(() => {
        rootLogger.log('All done');
        process.exit(0);
    }).catch(e => {
        console.error(e);
        process.exit(1);
    });
}
