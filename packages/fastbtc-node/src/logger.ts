import debug from 'debug';

type LogLevel =  'debug' | 'info' | 'warning' | 'error';
const LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warning', 'error'];

export default class Logger {
    //private debuggers: {
    //    debug: debug.Debugger,
    //    info: debug.Debugger,
    //    warning: debug.Debugger,
    //    error: debug.Debugger,
    //};
    private debuggers = console;

    private levelNamespaces: {
        debug: string,
        info: string,
        warning: string,
        error: string,
    }

    private rootNamespace = 'fastbtc'

    constructor(namespace?: string) {
        const ns = namespace ? `${namespace}:` : '';
        this.levelNamespaces = {
            debug: `${this.rootNamespace}:debug${ns}`,
            info: `${this.rootNamespace}:info${ns}`,
            warning: `${this.rootNamespace}:warning${ns}`,
            error: `${this.rootNamespace}:error${ns}`,
        };
        // TODO: asdfs
        //this.debuggers = {
        //    debug: debug(this.levelNamespaces.debug),
        //    info: debug(this.levelNamespaces.info),
        //    warning: debug(this.levelNamespaces.warning),
        //    error: debug(this.levelNamespaces.error),
        //};
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

    warn(message?: any, ...optionalParams: any[]) {
        this.debuggers.warn(message, ...optionalParams);
    }

    warning(message?: any, ...optionalParams: any[]) {
        this.warning(message, ...optionalParams);
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
