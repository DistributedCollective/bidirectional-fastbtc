import {StatsD} from 'hot-shots';
import {Container} from 'inversify';
import {Config} from "../config";
import {URL} from "url";

class DummyStatsD extends StatsD {
    constructor() {
        super();
    }

    sendMessage(message: any, callback: (a: any) => void) {
        if(callback) {
            callback(null);
        }
    }
}

export const TYPES = {
    StatsD: Symbol.for("StatsD")
};

export function setupInversify(container: Container) {
    container.bind<StatsD>(TYPES.StatsD).toDynamicValue((ctx) => {
        const config = ctx.container.get<Config>(Config);

        if (! config.statsdUrl) {
            return new DummyStatsD();
        }

        const parsed = new URL(config.statsdUrl);
        return new StatsD({
            host: parsed.hostname,
            port: +parsed.port,
        })
    }).inSingletonScope();
}
