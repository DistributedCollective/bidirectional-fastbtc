import {Container} from "inversify";
import {Config, createEnvConfig} from './config';
import * as db from './db';
import * as rsk from './rsk';
import * as p2p from './p2p';
import * as btc from './btc';
import * as core from './core';
//import { FastBTCNode } from './main';

function bootstrap(): Container {
    const container = new Container();

    container.bind<Config>(Config).toConstantValue(
        createEnvConfig()
    );

    db.setupInversify(container);
    rsk.setupInversify(container);
    p2p.setupInversify(container);
    btc.setupInversify(container);
    core.setupInversify(container);

    //container.bind<FastBTCNode>(FastBTCNode).toSelf();

    return container;
}

export default bootstrap;
