import * as fs from "fs";
import {decryptSecrets, encryptSecrets, promptPassword} from "../utils/secrets";

async function run(): Promise<void> {
    let path = '/config/fastbtc_config.json';
    const contents = fs.readFileSync(path);
    const payload = JSON.parse(contents.toString("utf8"));
    if (! payload.hasOwnProperty('salt')) {
        throw new Error("Looks like the file is not encrypted");
    }

    const password = await promptPassword();
    const decrypted = decryptSecrets(Buffer.from(password, "utf8"), contents.toString("utf8"));
    fs.writeFileSync(path, Buffer.from(JSON.stringify(decrypted, undefined, 4), "utf8"));
}

run().then(function () {
    console.log('Success!');
}).catch(function (e) {
    console.error(e);
})
