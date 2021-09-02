import {inject, injectable} from 'inversify';
import {EventScanner, Scanner} from './rsk/scanner';
import {P2PNetwork} from './p2p/network';
import {Network} from 'ataraxia';
import {sleep} from './utils';
import * as net from 'net';

@injectable()
export class FastBTCNode {
    private running = false;

    constructor(
        @inject(Scanner) private eventScanner: EventScanner,
        @inject(P2PNetwork) private network: Network,
    ) {
        network.onNodeAvailable(node => {
            console.log('A new node is available', node);
        });
        network.onNodeUnavailable(node => {
            console.log('Node no longer available', node);
        });
        network.onMessage(msg => {
            console.log('A new message was received:', msg);
        });
    }

    async run() {
        this.running = true;
        const network = this.network;
        await network.join();

        console.log('Network', network);
        console.log('Entering main loop')
        try {
            while(this.running) {
                const initiatorId = this.getInitiatorId();
                const isInitiator = network.networkId === initiatorId;
                console.log('node id:      ', network.networkId);
                console.log('initiator id: ', initiatorId);
                console.log('is initiator?:', isInitiator);
                console.log('nodes online: ', network.nodes.length);
                await sleep(10000);
            }
        } finally {
            await network.leave();
        }
    }

    getInitiatorId(): string|null {
        const ids = this.network.nodes.map(n => n.id);
        if(ids.length === 0) {
            return null;
        }
        ids.sort();
        return ids[0];
    }
}
