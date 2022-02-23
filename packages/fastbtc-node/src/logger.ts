type LogLevel =  'debug' | 'info' | 'warning' | 'error';
const LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warning', 'error'];

/**
 * Get the caller location as string
 * @param level the level. 1 is the function that called getCallerLocation itself
 */
function getCallerLocation(level: number): string {
    let e = new Error();
    return (e as any).stack.split("\n")[level + 1];
}

export default class Logger {
    private debuggers = console;
    private lastMessages = new Map<string, {message: string, timeout: number}>();
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

    exception(err: any, message?: any, ...optionalParams: any[]) {
        if (message || optionalParams.length) {
            this.debuggers.error(message, ...optionalParams);
        }
        this.debuggers.error(err);
    }

    throttledInfo(message: string, resendSeconds = 60) {
        const location = getCallerLocation(2);
        let entry = this.lastMessages.get(location);
        const time = Date.now();
        if (! entry || entry.message !== message || entry.timeout < time) {
            this.info(message);
            this.lastMessages.set(location, {
                message,
                timeout: Date.now() + resendSeconds * 1000
            });
        }
    }
}
