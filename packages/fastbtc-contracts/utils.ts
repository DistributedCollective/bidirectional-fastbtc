import * as readline from 'readline';
import {BigNumber, ethers} from 'ethers';

export async function readInput(question: string): Promise<string> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise(resolve => {
        rl.question(question, (answer: string) => {
            rl.close();
            resolve(answer);
        });
    });
}

export function leftPad(str: string, length: number, padChar = ' '): string {
    while (str.length < length) {
        str = padChar + str;
    }
    return str;
}

export function rightPad(str: string, length: number, padChar = ' '): string {
    while (str.length < length) {
        str = str + padChar;
    }
    return str;
}


// Shamelessly copied from fastbtc-node/utils.ts
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
        console.debug(`Querying events from ${fromBlock} to ${batchToBlock} (up to ${toBlock})`);
        for (const filter of filters) {
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


export async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    })
}
