import {ethers} from 'hardhat';
import { BigNumber, BigNumberish } from 'ethers';

export async function mineToBlock(targetBlock: number) {
    while (await ethers.provider.getBlockNumber() < targetBlock) {
        await ethers.provider.send('evm_mine', []);
    }
}


export async function setNextBlockTimestamp(timestamp: BigNumberish) {
    await ethers.provider.send("evm_setNextBlockTimestamp", [
        BigNumber.from(timestamp).toHexString()
    ]);
}
