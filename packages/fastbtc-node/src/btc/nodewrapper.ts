import {URL} from 'url';

const RPCClient = require('rpc-client');
type RPCClient = typeof RPCClient;

export interface BitcoinNodeWrapperOpts {
    url: string;
    user: string;
    password: string;
}

export default class BitcoinNodeWrapper {
    private client: RPCClient;

    constructor({url, user, password}: BitcoinNodeWrapperOpts) {
        const uri = new URL(url);
        this.client = new RPCClient({
            host: uri.hostname,
            port: uri.port,
            protocol: uri.protocol
        });
        if (user || password) {
            this.client.setBasicAuth(user, password);
        }
    }

    async call(method: string, params: any = null): Promise<any>{
        return new Promise((resolve, reject) => {
            this.client.call(method, params, (err: any, res: any) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve(res);
                }
            });
        });
    }

    async getLastBlock(): Promise<number|undefined> {
        const res = await this.call('getblockchaininfo');
        return res && res.blocks;
    }
}


