import {Container} from "inversify";
import {Config, createEnvConfig} from './config';
import * as db from './db';
import * as rsk from './rsk';
import * as p2p from './p2p';

function bootstrap(): Container {
    const container = new Container();

    container.bind<Config>(Config).toConstantValue(
        createEnvConfig()
    );

    db.setupInversify(container);
    rsk.setupInversify(container);
    p2p.setupInversify(container);
    return container;
}

export default bootstrap;
