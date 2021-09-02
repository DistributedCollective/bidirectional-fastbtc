import bootstrap from "./inversify.config";
import {Config} from './config';
import {FastBTCNode} from './main';
import {ConnectionProvider} from './db/connection';

async function main() {
    console.log(`Hello, fastbtc-node here.`);
    let container = bootstrap();

    const config = container.get<Config>(Config);
    console.log('My config is', config);

    // TODO: this is silly, but we have to init the connection. Architect this thing better
    await container.get<ConnectionProvider>(ConnectionProvider)();

    const node = container.get<FastBTCNode>(FastBTCNode);
    await node.run();
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
