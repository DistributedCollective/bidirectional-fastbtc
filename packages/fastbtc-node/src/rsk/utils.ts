import {ethers} from 'ethers';

export async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    })
}

export interface GetEventsOpts {
    batchSize?: number;
    retries?: number;
    initialRetrySleepMs?: number;
}
export async function getEvents(
    contract: ethers.Contract,
    event: ethers.EventFilter,
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
                    event,
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
