export interface Alerter {
    // Send an alert, without caring about promises or error handling
    alert(message: string): void;

    // Send an alert, but only once per `interval` seconds
    throttledAlert(key: string, message: string, intervalSeconds: number): void;
}

export const Alerter = Symbol.for('Alerter')
