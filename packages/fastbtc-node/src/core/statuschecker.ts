import {inject, injectable} from 'inversify';
import {EthersSigner, FastBtcBridgeContract} from '../rsk/base';
import {ethers} from 'ethers';
import Logger from '../logger';
import {sleep} from '../utils';

export const EXIT_STATUS_NO_LONGER_FEDERATOR = 101;
export const EXIT_STATUS_NOT_FEDERATOR_AFTER_WAITING = 102;

@injectable()
class StatusChecker {
    private logger = new Logger('statuschecker');
    private _thisNodeAddress: string | null = null;

    constructor(
        @inject(EthersSigner) private ethersSigner: ethers.Signer,
        @inject(FastBtcBridgeContract) private fastBtcBridge: ethers.Contract
    ) {
    }

    async makeSureThatThisNodeIsStillAFederator(): Promise<void> {
        try {
            if (! await this.isThisNodeAFederator()) {
                this.logger.warning(
                    'This node (%s) is no longer a federator -- quitting',
                    await this.getThisNodeAddress(),
                );
                process.exit(EXIT_STATUS_NO_LONGER_FEDERATOR);
            }
        } catch (e: any) {
            this.logger.exception(e, 'Error checking if this node is a federator, ignoring');
        }
    }

    async waitUntilThisNodeIsAFederator(maxWaitSeconds: number = 120) {
        const waitTimeSeconds = 10;
        do {
            try {
                if (await this.isThisNodeAFederator()) {
                    return;
                }
                this.logger.warning(
                    'This node (%s) is not a federator -- waiting for %s more seconds before calling it quits',
                    await this.getThisNodeAddress(),
                    maxWaitSeconds
                );
            } catch (e: any) {
                this.logger.exception(e, 'Error checking if this node is a federator, ignoring');
            }

            maxWaitSeconds -= waitTimeSeconds;
            await sleep(waitTimeSeconds * 1000);
        } while (maxWaitSeconds > 0);

        this.logger.warning('This node not a federator after waiting -- quitting')
        process.exit(EXIT_STATUS_NOT_FEDERATOR_AFTER_WAITING);
    }

    async isThisNodeAFederator() {
        const federatorAddresses = await this.fastBtcBridge.federators();
        const thisNodeAddress = await this.getThisNodeAddress();
        return federatorAddresses.indexOf(thisNodeAddress) !== -1;
    }

    private async getThisNodeAddress(): Promise<string> {
        if (this._thisNodeAddress === null) {
            this._thisNodeAddress = await this.ethersSigner.getAddress();
        }
        return this._thisNodeAddress;
    }
}


export default StatusChecker;
