import {interfaces} from 'inversify';
import Container = interfaces.Container;
import * as base from './base';
import * as scanner from './scanner';

export function setupInversify(container: Container) {
    base.bindAllToContainer(container);
    container.bind<scanner.EventScanner>(scanner.Scanner).to(scanner.EventScanner).inSingletonScope();
}
