// This is forked from the built version of rpc-client npm package (https://www.npmjs.com/package/rpc-client, MIT),
// But altered slightly to allow for better error messages. And (very lazily) converted to typescript
import http, {ClientRequest} from 'http';
import https from 'https';

export interface Options {
    host: string;
    port: string;
    method: string;
    path: string;
    headers: any;
    auth?: string;
}

export interface Auth {
    sign(options: Options, request: any): string|undefined;
}

export class BasicAuth {
    constructor(public username?: string, public password?: string) {
    }

    sign(options: Options, request: any): string|undefined {
        return options.auth = (this.username ?? '') + ":" + (this.password ?? '');
    };
}

export type ErrorLogger = (error: any, requestDebugInfo: {request: any, options: any}) => void;

export interface RPCClientOpts {
    protocol: string|null;
    host: string;
    port: string;
    path: string;
}
export class RPCClient {
    auth: Auth | null = null;
    transport: typeof http | typeof https;
    host: string;
    port: string;
    path: string;

    constructor(url: RPCClientOpts) {
        this.transport = (url.protocol != null) && url.protocol === "https" ? https : http;
        this.host = url.host;
        this.port = url.port;
        this.path = url.path;
    }

    setAuth(auth: Auth) {
        this.auth = auth;
    }

    setBasicAuth(username?: string, password?: string) {
        return this.setAuth(new BasicAuth(username, password));
    }

    call(method: string, params: any, callback: any, errorLogger?: ErrorLogger) {
        let options: Options;
        let query;
        let request;
        request = {
            method: method,
            params: params
        };
        options = {
            host: this.host,
            port: this.port,
            method: "post",
            path: this.path,
            headers: {
                Host: this.host
            }
        };
        if (this.auth != null) {
            this.auth.sign(options, request);
        }
        query = JSON.stringify(request);
        options.headers['Content-Length'] = query.length;
        options.headers["Content-Type"] = "application/json";

        const requestDebugInfo = { request, options };

        request = this.transport.request(options);
        request.on("error", function(err: any) {
            return callback(err);
        });
        request.on("response", function(response: any) {
            let buffer: any;
            buffer = '';
            response.on('data', function(chunk: any) {
                return buffer += chunk;
            });
            return response.on('end', function() {
                let e, err, json, msg;
                err = msg = null;
                try {
                    json = JSON.parse(buffer);
                    if (json.error != null) {
                        err = json.error;
                    }
                    if (json.result) {
                        msg = json.result;
                    }
                } catch (error) {
                    e = error;
                    err = e;
                }
                if (response.statusCode !== 200 && !err) {
                    err = {"message": "Server replied with : " + response.statusCode + ' ' + JSON.stringify(json)};
                }
                // Logging here spams too much. Save it for later.
                if (err && errorLogger) {
                    errorLogger(err, requestDebugInfo);
                }
                return callback(err, msg);
            });
        });
        return request.end(query);
    }
}

export default RPCClient;
