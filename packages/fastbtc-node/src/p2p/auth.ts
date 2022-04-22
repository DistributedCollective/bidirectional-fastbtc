/**
 * Peer-to-peer authentication logic with RSK signatures
 */
import {
    AuthClientFlow,
    AuthClientReplyType,
    AuthContext,
    AuthProvider,
    AuthServerFlow,
    AuthServerReplyType
} from 'ataraxia-transport';
import {randomBytes} from 'crypto';
import {ethers} from "ethers";
import {arrayify, hexlify} from "ethers/lib/utils";
import {TCPTransport} from "ataraxia-tcp";

/**
 * Options for `SharedSecretAuth`. Used to provide the shared secret.
 */
export interface RSKKeyedAuthOptions {
    getPeerAddresses: () => Promise<string[]>;
    signer: ethers.Signer;
}

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

function encode(json: Record<string, Json>): Buffer {
    return Buffer.from(JSON.stringify(json), 'utf-8');
}

function decode(data: Buffer): Record<string, Json> {
    return JSON.parse(data.toString('utf-8'));
}

function createMessage(
    challenge: Buffer,
    security: ArrayBuffer
) {
    return Buffer.concat([challenge, Buffer.from(security)])
}

/**
 * Monkey-patch the peer so that the public key pairs are supplied into the
 * challenge.
 */
const originalAddPeer = (TCPTransport as any).prototype.addPeer;
(TCPTransport as any).prototype.addPeer = function (peer: any) {
    peer.localPublicSecurity = function () {
        return Buffer.concat([this.stream.publicKey, this.stream.remotePublicKey]);
    };
    peer.remotePublicSecurity = function () {
        return Buffer.concat([this.stream.remotePublicKey, this.stream.publicKey]);
    };

    return originalAddPeer.apply(this, [peer]);
};
/**
 * RSKKeyedAuth. Allows entering the network if the node controls
 * one of the trusted private keys.
 **/
export class RSKKeyedAuth implements AuthProvider {
    public readonly id = 'rsk-keyed-auth';
    public readonly prefixString = 'fastbtc-p2p-auth:';

    private readonly signer: ethers.Signer;
    private readonly getPeerAddresses: () => Promise<string[]>;

    public constructor(options: RSKKeyedAuthOptions) {
        this.signer = options.signer;
        // TODO: we could enable some caching for this
        this.getPeerAddresses = options.getPeerAddresses;
    }

    public createClientFlow(context: AuthContext): AuthClientFlow {
        const challenge = randomBytes(32);
        const prefix = Buffer.from(this.prefixString, 'utf-8');
        const that = this;
        const remotePublicSecurity = context.remotePublicSecurity;
        if (! remotePublicSecurity) {
            throw Error("Remote public security tag not provided");
        }
        const localPublicSecurity = context.localPublicSecurity;
        if (! localPublicSecurity) {
            throw Error("Local public security tag not provided");
        }

        return {
            async initialMessage() {
                console.log("preparing challenge to server");
                return encode({
                    version: 1,
                    challenge: hexlify(challenge)
                });
            },

            async receiveData(data) {
                try {
                    const payload = decode(Buffer.from(data));
                    if (payload.version !== 1) {
                        console.error(`Invalid payload version ${payload.version} received from server`)
                        return {
                            type: AuthClientReplyType.Reject
                        };
                    }

                    const serverChallenge: Buffer = Buffer.from(arrayify(payload.challenge as any));
                    const serverResponse: string = payload.response as any;

                    const serverMessage = createMessage(Buffer.concat([prefix, challenge]), remotePublicSecurity);
                    const recoveredAddress = ethers.utils.verifyMessage(ethers.utils.arrayify(serverMessage), serverResponse);

                    const peerAddresses = await that.getPeerAddresses();
                    if (peerAddresses.indexOf(recoveredAddress as any) === -1) {
                        console.error(`Invalid signature from server, recovered address ` +
                            `${recoveredAddress} does not match any configured peer address`);

                        return {
                            type: AuthClientReplyType.Reject
                        };
                    }

                    const clientMessage = createMessage(Buffer.concat([prefix, serverChallenge]), localPublicSecurity);

                    console.log(`successful server challenge from ${recoveredAddress}`);
                    return {
                        type: AuthClientReplyType.Data,
                        data: encode({
                            response: await that.signer.signMessage(clientMessage)
                        })
                    };
                }
                catch (e) {
                    console.log(e);
                    return {
                        type: AuthClientReplyType.Reject
                    };
                }
            },

            async destroy() {
            }
        };
    }

    public createServerFlow(context: AuthContext): AuthServerFlow {
        const challenge = randomBytes(32);
        const prefix = Buffer.from(this.prefixString, 'utf-8');
        const that = this;
        const remotePublicSecurity = context.remotePublicSecurity;
        if (! remotePublicSecurity) {
            throw Error("Remote public security tag not provided");
        }
        const localPublicSecurity = context.localPublicSecurity;
        if (! localPublicSecurity) {
            throw Error("Local public security tag not provided");
        }

        return {
            async receiveInitial(data: ArrayBuffer) {
                console.log("received client authentication handshake");
                let payload;
                try {
                    payload = decode(Buffer.from(data));
                    if (payload.version !== 1) {
                        console.error(`Invalid payload version ${payload.version} received from client`);

                        return {
                            type: AuthServerReplyType.Reject
                        };
                    }

                    const serverMessage = createMessage(
                        Buffer.concat([prefix, Buffer.from(arrayify(payload.challenge as any))]),
                        localPublicSecurity,
                    );

                    return {
                        type: AuthServerReplyType.Data,
                        data: encode({
                            response: await that.signer.signMessage(serverMessage),
                            challenge: hexlify(challenge),
                            version: 1,
                        })
                    };
                }
                catch (e) {
                    console.error(e);
                    return {
                        type: AuthServerReplyType.Reject
                    };
                }
            },

            async receiveData(data) {
                try {
                    const payload = decode(Buffer.from(data));

                    // Calculate what the expected response is and compare them
                    const clientMessage = createMessage(Buffer.concat([prefix, challenge]), remotePublicSecurity);
                    const recoveredAddress = ethers.utils.verifyMessage(
                        ethers.utils.arrayify(clientMessage),
                        payload.response as any
                    );

                    const peerAddresses = await that.getPeerAddresses();

                    if (peerAddresses.indexOf(recoveredAddress as any) === -1) {
                        console.error(`Invalid signature from client, recovered address ` +
                            `${recoveredAddress} does not match any configured peer address`);

                        return {
                            type: AuthServerReplyType.Reject
                        };
                    }

                    console.log(`authentication successfully completed with ${recoveredAddress}`);
                    return {
                        type: AuthServerReplyType.Ok
                    };
                }
                catch (e) {
                    console.error(e);
                    return {
                        type: AuthServerReplyType.Reject
                    }
                }
            },

            async destroy() {
            }
        };
    }
}
