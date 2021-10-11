import {URL} from 'url';
import {injectable} from 'inversify';
import {Network, networks} from 'bitcoinjs-lib';

const RPCClient = require('rpc-client');
type RPCClient = typeof RPCClient;

export interface BitcoinNodeWrapperOpts {
    url: string;
    btcNetwork: 'regtest'|'mainnet'|'testnet';
    user?: string;
    password?: string;
}

export interface IBitcoinNodeWrapper {
    readonly network: Network;
    call(method: string, params: any): Promise<any>;
    getLastBlock(): Promise<number|undefined>;
}

@injectable()
export default class BitcoinNodeWrapper implements IBitcoinNodeWrapper {
    private client: RPCClient;
    public readonly network: Network;
    constructor({url, user, password, btcNetwork}: BitcoinNodeWrapperOpts) {
        this.network = networks[btcNetwork === 'mainnet' ? 'bitcoin' : btcNetwork];

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


