// This is forked from the built version of rpc-client npm package (https://www.npmjs.com/package/rpc-client, MIT),
// But altered slightly to allow for better error messages

const BasicAuth = (function() {
    function BasicAuthentication(username, password) {
        this.username = username;
        this.password = password;
    }

    BasicAuthentication.prototype.sign = function(options, request) {
        return options.auth = this.username + ":" + this.password;
    };

    return BasicAuthentication;

})();

const RPCClient = (function() {
    function Client(url) {
        this.transport = (url.protocol != null) && url.protocol === "https" ? require("https") : require("http");
        this.host = url.host;
        this.port = url.port;
        this.path = url.path;
    }

    Client.prototype.setAuth = function(auth) {
        this.auth = auth;
    };

    Client.prototype.setBasicAuth = function(username, password) {
        return this.setAuth(new BasicAuth(username, password));
    };

    Client.prototype.call = function(method, params, callback) {
        var options, query, request;
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
        request.on("error", function(err) {
            return callback(err);
        });
        request.on("response", function(response) {
            var buffer;
            buffer = '';
            response.on('data', function(chunk) {
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

    return Client;

})();

module.exports = RPCClient;
