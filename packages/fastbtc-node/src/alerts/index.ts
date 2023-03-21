import {interfaces} from 'inversify';
import Container = interfaces.Container;

import {Alerter} from './types';
import NullAlerter from './null';
import DiscordAlerter from './discord';
import {Config} from '../config';
import Logger from '../logger';

export function setupInversify(container: Container) {
    container.bind<Alerter>(Alerter).toDynamicValue(
        (context) => {
            const logger = new Logger('alerts');
            const config = context.container.get<Config>(Config);
            const webhookUrl = config.secrets().alerterDiscordWebhookUrl;
            if (!webhookUrl) {
                logger.info('No Discord webhook URL configured, alerts will be disabled');
                return new NullAlerter();
            } else {
                return new DiscordAlerter(
                    webhookUrl,
                )
            }
        },
    ).inSingletonScope();
}
