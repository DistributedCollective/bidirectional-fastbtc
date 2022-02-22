import Logger from './logger';
import bootstrap from "./inversify.config";
import {Config, getCensoredConfig} from './config';
import {FastBTCNode} from './core/node';
import {ConnectionProvider} from './db/connection';
import {BitcoinMultisig} from './btc/multisig';

const rootLogger = new Logger();

async function main() {
    rootLogger.enable();

    rootLogger.log(`Hello, fastbtc-node here.`);
    let container = await bootstrap();

    const config = await container.get<Config>(Config);
    rootLogger.log('My config is', getCensoredConfig(config));

    const btcMultisig = container.get<BitcoinMultisig>(BitcoinMultisig);
    if (!await btcMultisig.healthCheck()) {
        rootLogger.error(
            `ERROR: Connection to the Bitcoin multisig at ${config.btcRpcUrl} cannot be established -- quitting!`
        )
        process.exit(1);
    }

    // This is silly, but we have to init the connection. Maybe architect this thing better
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
