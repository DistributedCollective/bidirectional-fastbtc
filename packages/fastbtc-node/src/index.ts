import bootstrap from "./inversify.config";
import {Config} from './config';
import {ConnectionProvider} from './db/connection';
import {EventScanner, Scanner} from './rsk/scanner';
import {Transfer} from './db/models';
import {P2PNetwork} from './p2p/network';
import {Network} from 'ataraxia';
import {sleep} from './utils';

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

    const network = container.get<Network>(P2PNetwork);
    network.onNodeAvailable(node => {
        console.log('A new node is available', node);
    });
    network.onNodeUnavailable(node => {
        console.log('Node no longer available', node);
    });
    network.onMessage(msg => {
        console.log('A new message was received:', msg);
    });
    await network.join();

    console.log('Network', network);
    console.log('Entering main loop')
    try {
        while(true) {
            console.log('My id:', network.networkId);
            console.log('Nodes', network.nodes);
            await sleep(5000);
        }
    } finally {
        await network.leave();
    }
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
