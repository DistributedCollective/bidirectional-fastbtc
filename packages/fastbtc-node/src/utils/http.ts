import http from 'http';
import https from 'https';

export async function get(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const transport = url.startsWith('https') ? https : http;
        transport.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => resolve(data));
            res.on('error', reject);
        });
    });
}


export async function getJson(url: string): Promise<any> {
    return JSON.parse(await get(url));
}
