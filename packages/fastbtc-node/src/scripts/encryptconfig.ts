import * as fs from "fs";
import {encryptSecrets, promptPassword} from "../utils/secrets";

async function run(): Promise<void> {
    let path = '/config/fastbtc_config.json';
    const contents = fs.readFileSync(path);
    const payload = JSON.parse(contents.toString("utf8"));
    if (payload.hasOwnProperty('salt')) {
        throw new Error("Looks like the file is already encrypted");
    }

    const password = await promptPassword();
    const encrypted = encryptSecrets(Buffer.from(password, "utf8"), payload);
    fs.writeFileSync(path, encrypted);
}

run().then(function () {
    console.log('Success!');
}).catch(function (e) {
    console.error(e);
})
