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

    // this doesn't set event.args correctly
    //const filter = createCombinedOrFilter(filters);

    if(!Array.isArray(filters)) {
        filters = [filters];
    }

    const events: ethers.Event[] = [];
    while (fromBlock <= toBlock) {
        const batchToBlock = Math.min(toBlock, fromBlock + batchSize - 1);
        // TODO: this is ugly, we do 1 call for each event though we could just retrieve all events in a single
        // call by creating a combined OR filter. but the current implementation doesn't set event.args and I
        // don't have time to fix it now. So someone fix it later please.
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
 * Join all given filters with OR clause to create a single EventFilter
 *
 * TODO: when giving multiple events, args is not set! ARGH
 *
 * @param filters Array of filters to join, or a single filter
 */
function createCombinedOrFilter(
    filters: ethers.EventFilter | ethers.EventFilter[],
): ethers.EventFilter {
    if (!Array.isArray(filters)) {
        return filters;
    }

    let filter: ethers.EventFilter;
    if (filters.length === 0) {
        throw new Error('must pass in at least 1 event filter')
    } else if (filters.length === 1) {
        filter = filters[0];
    } else {
        const topicsCombinedWithOr: string[] = [];
        for (let f of filters) {
            if (f.address !== filters[0].address) {
                throw new Error('all events must have the same address');
            }
            if (!f.topics || f.topics.length !== 1 || Array.isArray(f.topics[0])) {
                throw new Error('each event is supposed to have exactly 1 topic');
            }
            topicsCombinedWithOr.push(f.topics[0]);
        }
        filter = {
            address: filters[0].address,
            // to get OR filtering, we must pass in [[A, B]] ([A, B] would be AND)
            topics: [topicsCombinedWithOr],
        };
    }

    return filter;
}
