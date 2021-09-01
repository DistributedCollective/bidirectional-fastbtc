const fs = require('fs');
const contractsDir = `${__dirname}/../fastbtc-contracts/artifacts/contracts`
const abiOutputDir = `${__dirname}/src/rsk/abi`;

function main() {
    for(let name of [
        'FastBTCBridge',
    ]) {
        const inFile = `${contractsDir}/${name}.sol/${name}.json`;
        const outFile = `${abiOutputDir}/${name}.json`;
        console.log(`Reading ${inFile}`);
        if(!fs.existsSync(inFile)) {
            console.error(`Path ${inFile} not found`)
            process.exit(1);
        }
        const jsonData = JSON.parse(fs.readFileSync(inFile, 'utf-8'));
        console.log(`Writing ${outFile}`);
        fs.writeFileSync(
            outFile,
            JSON.stringify(jsonData.abi, null, 4)
        );
    }
    console.log('All done.')
}

if (require.main === module) {
    main();
}
