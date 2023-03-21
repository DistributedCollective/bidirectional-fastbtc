import {Alerter} from './types';
import Logger from '../logger';

export default class NullAlerter implements Alerter {
    private logger = new Logger('null-alerter');
    private lastAlerts: Record<string, number> = {};

    alert(message: string): void {
        this.logger.warning('Alert: ' + message);
    }

    throttledAlert(key: string, message: string, intervalSeconds: number) {
        const now = Date.now();
        const lastAlert = this.lastAlerts[key];
        const intervalMs = intervalSeconds * 1000;
        if (!lastAlert || now - lastAlert > intervalMs) {
            this.lastAlerts[key] = now;
            this.alert(message);
        }
    }
}
