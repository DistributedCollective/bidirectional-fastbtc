import {interfaces} from 'inversify';
import Container = interfaces.Container;

import {RBTCWithdrawer, RBTCWithdrawerImpl} from './withdrawer';

export function setupInversify(container: Container) {
    container.bind<RBTCWithdrawer>(RBTCWithdrawer).to(RBTCWithdrawerImpl).inSingletonScope();
}
