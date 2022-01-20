import * as fs from "fs";
import {encryptSecrets, promptPassword} from "../utils/secrets";

async function run(): Promise<string> {
    let path = '/config/fastbtc_config.json';
    const contents = fs.readFileSync(path);
    const payload = JSON.parse(contents.toString("utf8"));
    if (payload.hasOwnProperty('salt')) {
        return "Looks like the file is already encrypted";
    }

    const password = await promptPassword();
    console.log("");
    const passwordAgain = await promptPassword("Password again: ");
    if (passwordAgain != password) {
        return "Passwords do not match!";
    }
    const encrypted = encryptSecrets(Buffer.from(password, "utf8"), payload);
    fs.writeFileSync(path, encrypted);
    return "Success!";
}

run().then(function (rv) {
    console.log(rv);
}).catch(function (e) {
    console.error(e);
})
