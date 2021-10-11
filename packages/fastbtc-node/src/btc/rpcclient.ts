export const RPCClient = require('rpc-client');
export type RPCClient = typeof RPCClient;

// LOL MONKEY PATCH
// edit this slightly to show nicer debug info on errors.
// TODO: actually fork the whole thing instead of doing a lame monkey-patch like this
RPCClient.prototype.call = function(method: any, params: any, callback: any) {
    var options: any, query, request;
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

    const requestDebugInfo: any = { request, options };

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
            var e, err, json, msg;
            err = msg = null;
            try {
                json = JSON.parse(buffer);
                if (json.error != null) {
                    err = json.err;
                }
                if (json.result) {
                    msg = json.result;
                }
            } catch (error) {
                e = error;
                err = e;
            }
            if (response.statusCode !== 200) {
                err = "Server replied with : " + response.statusCode + ' ' + JSON.stringify(json);
            }
            if (err) {
                console.error('RPC request:', requestDebugInfo, 'caused error:', err);
            }
            return callback(err, msg);
        });
    });
    return request.end(query);
};
