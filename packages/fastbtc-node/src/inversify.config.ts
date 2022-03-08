import {Container} from "inversify";
import {Config, envConfigProviderFactory} from './config';
import * as db from './db';
import * as rsk from './rsk';
import * as p2p from './p2p';
import * as btc from './btc';
import * as core from './core';
import * as stats from './stats';
import * as replenisher from './replenisher';

async function bootstrap(): Promise<Container> {
    const container = new Container();

    container.bind<Config>(Config).toDynamicValue(
        await envConfigProviderFactory()
    ).inSingletonScope();

    db.setupInversify(container);
    rsk.setupInversify(container);
    p2p.setupInversify(container);
    btc.setupInversify(container);
    replenisher.setupInversify(container);
    core.setupInversify(container);
    stats.setupInversify(container);
    return container;
}

export default bootstrap;
