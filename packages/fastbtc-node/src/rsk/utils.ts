import {ethers} from 'ethers';
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

    let filter: ethers.EventFilter;
    if (Array.isArray(filters)) {
        if (filters.length === 0) {
            throw new Error('must pass in at least 1 event filter')
        }
        filter = {
            address: filters[0].address,
            topics: [],
        };
        for (let f of filters) {
            if (f.address !== filter.address) {
                throw new Error('all events must have the same address');
            }
            if (f.topics) {
                filter.topics?.push(...f.topics);
            }
        }
    } else {
        filter = filters;
    }

    const events: ethers.Event[] = [];
    while (fromBlock <= toBlock) {
        const batchToBlock = Math.min(toBlock, fromBlock + batchSize - 1);
        console.debug(`Querying from ${fromBlock} to ${batchToBlock} (up to ${toBlock})`);
        let eventBatch: ethers.Event[];
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
        fromBlock = batchToBlock + 1;
    }
    return events;
}
