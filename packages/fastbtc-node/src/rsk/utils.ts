import {BigNumber, ethers} from 'ethers';
import {sleep} from '../utils';

export interface GetEventsOpts {
    batchSize?: number;
    retries?: number;
    initialRetrySleepMs?: number;
}
export async function getEvents(
    contract: ethers.Contract,
    filters: ethers.EventFilter | ethers.EventFilter[],
    fromBlock: number,
    toBlock: number,
    opts: GetEventsOpts = {}
): Promise<ethers.Event[]> {
    const {
        batchSize = 100,
        retries = 3,
        initialRetrySleepMs = 500,
    } = opts;

    if (batchSize < 1) {
        throw new Error('batch size must be at least 1');
    }

    if(!Array.isArray(filters)) {
        filters = [filters];
    }

    const events: ethers.Event[] = [];
    while (fromBlock <= toBlock) {
        const batchToBlock = Math.min(toBlock, fromBlock + batchSize - 1);
        // This could be improved by retrieving all events in a single call
        for (const filter of filters) {
            console.debug(`Querying from ${fromBlock} to ${batchToBlock} (up to ${toBlock})`);
            let eventBatch: ethers.Event[] = [];
            let attempt = 0;
            while (true) {
                attempt++;
                try {
                    eventBatch = await contract.queryFilter(
                        filter,
                        fromBlock,
                        batchToBlock
                    );
                    break
                } catch (e) {
                    if (attempt > retries) {
                        throw e;
                    }
                    console.warn(`Error fetching events (${attempt}/${retries}):`, e);
                    await sleep(initialRetrySleepMs * attempt);
                }
            }
            if (eventBatch.length) {
                console.debug(`Got ${eventBatch.length} events in batch`);
                events.push(...eventBatch);
            }
        }
        fromBlock = batchToBlock + 1;
    }

    // Ethers probably returns the event as sorted anyways,
    // but let's be sure
    events.sort((a, b) => {
        if (a.blockNumber !== b.blockNumber) {
            return a.blockNumber < b.blockNumber ? -1 : 1;
        }
        if (a.transactionIndex !== b.transactionIndex) {
            return a.transactionIndex < b.transactionIndex ? -1 : 1;
        }
        if (a.logIndex !== b.logIndex) {
            return a.logIndex < b.logIndex ? -1 : 1;
        }
        return 0;
    })

    return events;
}

/**
 * Convert BigNumbers to numbers, leave numbers be
 *
 * Ethers returns uint8 as number but uint256 as BigNumber. So this way it always works.
 *
 * @param n
 */
export function toNumber(n: BigNumber | number): number {
    if (BigNumber.isBigNumber(n)) {
        return n.toNumber();
    }
    return n;
}
