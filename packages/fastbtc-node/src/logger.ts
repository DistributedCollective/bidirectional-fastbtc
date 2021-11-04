import debug from 'debug';

const rootNamespace = 'fastbtc';

const foo = typeof console;

type ConsoleMethod = (message?: any, ...optionalParams: any[]) => void;

type LogLevel =  'debug' | 'info' | 'error';
const LOG_LEVELS: LogLevel[] = ['debug', 'info', 'error'];

export default class Logger {
    private debuggers: {
        debug: debug.Debugger,
        info: debug.Debugger,
        error: debug.Debugger,
    };

    private levelNamespaces: {
        debug: string,
        info: string,
        error: string,
    }

    private rootNamespace = 'fastbtc'

    constructor(namespace?: string) {
        const ns = namespace ? `${namespace}:` : '';
        this.levelNamespaces = {
            debug: `${this.rootNamespace}:debug${ns}`,
            info: `${this.rootNamespace}:info${ns}`,
            error: `${this.rootNamespace}:error${ns}`,
        };
        this.debuggers = {
            debug: debug(this.levelNamespaces.debug),
            info: debug(this.levelNamespaces.info),
            error: debug(this.levelNamespaces.error),
        };
    }

    enable(level: LogLevel = 'debug') {
        const start = LOG_LEVELS.indexOf(level);
        if (start === -1) {
            throw new Error(`invalid log level: ${level}`)
        }
        for (let i = start; i < LOG_LEVELS.length; i++) {
            debug.enable(this.levelNamespaces[LOG_LEVELS[i]]);
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

    error(message?: any, ...optionalParams: any[]) {
        this.debuggers.error(message, ...optionalParams);
    }
}
