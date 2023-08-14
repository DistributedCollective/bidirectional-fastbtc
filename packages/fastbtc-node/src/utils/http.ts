import http from 'http';
import https from 'https';

// TODO: replace these with node-fetch
// The node http/https api is full of gotchas. And the ad-hoc API here is way worse than just using fetch.
export async function get(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const transport = url.startsWith('https') ? https : http;
        transport.get(url, (res) => {
            if (res?.statusCode && res.statusCode >= 400) {
                reject(new Error(`Request failed with status code ${res.statusCode}`));
                return;
            }

            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => resolve(data));
            res.on('error', reject);
        }).on('error', (err) => {
            console.error(`Error while requesting ${url}: ${err.message}`);
            reject(err);
        });
    });
}


export async function getJson(url: string): Promise<any> {
    return JSON.parse(await get(url));
}
