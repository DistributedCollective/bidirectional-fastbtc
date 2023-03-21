import https from 'https';
import {URL} from 'url';

import {Alerter} from './types';
import Logger from '../logger';

export default class DiscordAlerter implements Alerter {
    private logger = new Logger('discord-alerter');
    private parsedWebhookUrl: URL;
    private lastAlerts: Record<string, number> = {};

    constructor(
        private readonly webhookUrl: string,
        private readonly username: string = 'Bi-di FastBTC Alerter',
    ) {
        this.parsedWebhookUrl = new URL(webhookUrl);
    }

    alert(message: string): void {
        try {
            this._alert(message);
        } catch (e) {
            this.logger.exception(e, 'Failed to send alert');
        }
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

    private _alert(message: string) {
        // send message using discord webhook
        const body: Record<string, string> = {
            content: message,
        }
        if (this.username) {
            body.username = this.username;
        }
        const options = {
            host: this.parsedWebhookUrl.hostname,
            port: this.parsedWebhookUrl.port,
            path: this.parsedWebhookUrl.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Host': this.parsedWebhookUrl.hostname,
            },
        }

        const req = https.request(options, (res) => {
            this.logger.debug(`statusCode: ${res.statusCode}`)
            res.on('data', (d) => {
                this.logger.debug(d);
            })
        });
        req.on('error', (error) => {
            this.logger.error(error);
        });
        req.write(JSON.stringify(body));
        req.end();
    }
}
