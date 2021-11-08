type LogLevel =  'debug' | 'info' | 'warning' | 'error';
const LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warning', 'error'];

export default class Logger {
    private debuggers = console;

    constructor(namespace?: string) {
        // Do something with the namespace later.
    }

    enable(level: LogLevel = 'debug') {
        // Do something clever with this later
        const start = LOG_LEVELS.indexOf(level);
        if (start === -1) {
            throw new Error(`invalid log level: ${level}`)
        }
    }

    log(message?: any, ...optionalParams: any[]) {
        this.debuggers.info(message, ...optionalParams);
    }

    info(message?: any, ...optionalParams: any[]) {
        this.debuggers.info(message, ...optionalParams);
    }

    debug(message?: any, ...optionalParams: any[]) {
        this.debuggers.debug(message, ...optionalParams);
    }

    warn(message?: any, ...optionalParams: any[]) {
        this.debuggers.warn(message, ...optionalParams);
    }

    warning(message?: any, ...optionalParams: any[]) {
        this.warn(message, ...optionalParams);
    }

    error(message?: any, ...optionalParams: any[]) {
        this.debuggers.error(message, ...optionalParams);
    }

    exception(err: Error, message?: any, ...optionalParams: any[]) {
        if (message || optionalParams.length) {
            this.debuggers.error(message, ...optionalParams);
        }
        this.debuggers.error(err);
    }
}
