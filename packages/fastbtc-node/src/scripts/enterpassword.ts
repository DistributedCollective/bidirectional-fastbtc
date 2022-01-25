import * as http from 'http';
import {Writable} from 'stream';
import readline from 'readline';
import {promptPassword} from "../utils/secrets";

async function run() {
    const options = {
        host: 'localhost',
        port: 1337,
        method: 'post',
        path: '/password',
        headers: {
            Host: 'localhost'
        } as {[key: string]: any}
    };

    while (true) {
        const password = await promptPassword();
        console.log();
        const payload = {password};
        const body = Buffer.from(JSON.stringify(payload), 'utf8');
        options.headers['Content-Length'] = body.length;
        options.headers['Content-Type'] = 'application/json';

        const promise = new Promise((resolve, reject) => {
            const request = http.request(options);
            request.on('error', function (err) {
                return reject(err);
            });
            request.on('response', function (response) {
                let contents = Buffer.of();
                response.on('data', function (d) {
                    contents = Buffer.concat([contents, d]);
                });

                response.on('end', function() {
                    const response = contents.toString('utf8');
                    const payload = JSON.parse(response);
                    if (payload.success) {
                        resolve(true);
                    }
                    else {
                        reject("server replied with " + payload.error);
                    }
                });

                response.on('error', reject);
            });
            request.end(body, 'utf-8');
        });

        try {
            return await promise;
        }
        catch (e) {
            console.log("Error: ", e);
        }
    }
}

run().then(function () { console.log('Success!'); });
