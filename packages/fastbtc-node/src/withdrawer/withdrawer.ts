import {inject, injectable} from 'inversify';
import Logger from "../logger";
import {BigNumber, Contract, ethers} from 'ethers';
import {Config} from '../config';
import {EthersProvider, EthersSigner} from '../rsk/base';
import withdrawerAbi from './abi/Withdrawer.json';
import {formatEther} from 'ethers/lib/utils';

export interface WithdrawerConfig {
    withdrawerContractAddress?: string;
    withdrawerMaxAmountWei: BigNumber;
    withdrawerThresholdWei: BigNumber;
}

export interface RBTCWithdrawer {
    handleWithdrawerIteration(): Promise<void>;
}

export const RBTCWithdrawer = Symbol.for('RBTCWithdrawer')

@injectable()
export class RBTCWithdrawerImpl implements RBTCWithdrawer {
    private logger = new Logger('withdrawer');
    private withdrawerContract?: Contract;
    private maxAmountWei: BigNumber;
    private thresholdWei: BigNumber;

    // rudimentary throttling to avoid wasting all gas
    private lastFailureTimestamp: number = 0;
    private timeBetweenFailures: number = 2 * 60 * 60 * 1000;

    constructor(
        @inject(EthersProvider) private ethersProvider: ethers.providers.Provider,
        @inject(EthersSigner) ethersSigner: ethers.Signer,
        @inject(Config) config: WithdrawerConfig,
    ) {
        if (config.withdrawerContractAddress) {
            this.withdrawerContract = new ethers.Contract(
                config.withdrawerContractAddress,
                withdrawerAbi,
                ethersSigner,
            );
        } else {
            this.logger.warn('No withdrawer contract address specified, withdrawer disabled');
            this.withdrawerContract = undefined;
        }
        this.maxAmountWei = config.withdrawerMaxAmountWei;
        this.thresholdWei = config.withdrawerThresholdWei;
    }

    async handleWithdrawerIteration(): Promise<void> {
        if (!this.withdrawerContract) {
            this.logger.throttledInfo('No withdrawer contract, skipping iteration');
            return;
        }

        const timeSinceLastFailure = Date.now() - this.lastFailureTimestamp;
        if (timeSinceLastFailure < this.timeBetweenFailures) {
            const timeToWait = this.timeBetweenFailures - timeSinceLastFailure;
            this.logger.info(
                `Last withdrawal failed ${timeSinceLastFailure/1000}s ago, waiting ${timeToWait/1000}s before trying again`
            );
            return;
        }

        const receiverBalance = await this.withdrawerContract.receiverBalance();
        if (receiverBalance.gte(this.thresholdWei)) {
            this.logger.throttledInfo('Receiver balance is above threshold, skipping withdrawal');
            return;
        }

        const hasWithdrawPermissions = await this.withdrawerContract.hasWithdrawPermissions();
        if (!hasWithdrawPermissions) {
            this.logger.warn('Withdrawer contract does not have permissions to withdraw!');
            return;
        }

        const amountWithdrawable = await this.withdrawerContract.amountWithdrawable();
        if (amountWithdrawable.isZero()) {
            this.logger.throttledInfo(
                'No withdrawable funds or not enough time passed since last withdrawal, skipping'
            );
            return;
        }

        const receiver = await this.withdrawerContract.receiver();
        const amountToWithdraw = amountWithdrawable.gt(this.maxAmountWei) ? this.maxAmountWei : amountWithdrawable;
        this.logger.info(`Withdrawing ${formatEther(amountToWithdraw)} rBTC to receiver ${receiver}`);

        try {
            const result = await this.withdrawerContract.withdrawRbtcToReceiver(amountToWithdraw);
            const txHash = result.hash;
            this.logger.info(`Withdrew ${formatEther(amountToWithdraw)} rBTC to receiver ${receiver}, txHash: ${txHash}`);
            const receipt = await this.ethersProvider.waitForTransaction(
                txHash,
                1, // 1 confirmation enough for now
                5 * 60 * 1000, // wait max 5 minutes
            );
            if (!receipt.status) {
                this.logger.error('Withdrawer tx failed: %s', txHash);
                this.lastFailureTimestamp = Date.now();
            }
        } catch (e) {
            this.logger.exception(e, 'Withdrawer error');
            this.lastFailureTimestamp = Date.now();
        }
    }
}
