const child_process = require('child_process');
child_process.spawnSync(
    "./node_modules/typeorm/cli.js",
    ['migration:run'],
    {stdio: 'inherit'}
);

const main = require('./dist/index.js')['default'];
main();
