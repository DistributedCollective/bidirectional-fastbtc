const child_process = require('child_process');
const ormconfig = require('./ormconfig');


const rskUrl = process.env.FASTBTC_RSK_RPC_URL;
if (!rskUrl) {
    throw new Error('required env var FASTBTC_RSK_RPC_URL not set!')
}


console.log('Waiting for postgresql startup at', ormconfig.url);
let dbWaitSuccess = false;
for(let attempt = 0; attempt < 100; attempt++) {
    const ret = child_process.spawnSync(
        "./node_modules/typeorm/cli.js",
        ['query', 'SELECT 1'],
    );
    //console.log('psql', ret);
    //console.log('stdout', ret.stdout.toString());
    //console.log('stderr', ret.stderr.toString());
    if (ret.status === 0) {
        dbWaitSuccess = true;
        break;
    }
    child_process.spawnSync(
        "sleep",
        ["1"],
    );
}
if (!dbWaitSuccess) {
    throw new Error('db wait failure');
}
console.log('PostgreSQL started');

child_process.spawnSync(
    "./node_modules/typeorm/cli.js",
    ['migration:run'],
    {stdio: 'inherit'}
);


console.log('Waiting for rsk network at', rskUrl);
let rskWaitSuccess = false;
for(let attempt = 0; attempt < 100; attempt++) {
    const ret = child_process.spawnSync(
        "curl",
        [rskUrl],
    );

    if (ret.status === null && ret.error?.code === 'ENOENT') {
        console.warn('curl not found. continuing anyway');
        rskWaitSuccess = true;
        break;
    }
    if (ret.status === 0) {
        rskWaitSuccess = true;
        break;
    }
    child_process.spawnSync(
        "sleep",
        ["2"],
    );
}
if (!rskWaitSuccess) {
    throw new Error('rsk wait failure');
}


const main = require('./dist/index.js')['default'];
main();
