const child_process = require('child_process');
const ormconfig = require('./ormconfig');

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

const main = require('./dist/index.js')['default'];
main();
