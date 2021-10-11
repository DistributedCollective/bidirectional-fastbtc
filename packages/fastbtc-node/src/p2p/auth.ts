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
    security: ArrayBuffer | undefined
) {
    if (security) {
        return Buffer.concat([challenge, Buffer.from(security)])
    } else {
        return Buffer.from(challenge);
    }
}


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
        return {
            async initialMessage() {
                return encode({
                    version: 1,
                    challenge: hexlify(challenge)
                });
            },

            async receiveData(data) {
                const payload = decode(Buffer.from(data));
                if (payload.version !== 1) {
                    console.error(`Invalid payload version ${payload.version} received from server`)
                    return {
                        type: AuthClientReplyType.Reject
                    };
                }

                const serverChallenge: Buffer = Buffer.from(arrayify(payload.challenge as any));
                const serverResponse: string = payload.response as any;

                const serverMessage = createMessage(Buffer.concat([prefix, challenge]), context.remotePublicSecurity);
                const recoveredAddress = ethers.utils.verifyMessage(ethers.utils.arrayify(serverMessage), serverResponse);

                const peerAddresses = await that.getPeerAddresses();
                if (peerAddresses.indexOf(recoveredAddress as any) === -1) {
                    console.error(`Invalid signature from server, recovered address ` +
                        `${recoveredAddress} does not match any configured peer address`);

                    return {
                        type: AuthClientReplyType.Reject
                    };
                }

                const clientMessage = createMessage(Buffer.concat([prefix, serverChallenge]), context.localPublicSecurity);

                console.log(`successful server challenge from ${recoveredAddress}`);
                return {
                    type: AuthClientReplyType.Data,
                    data: encode({
                        response: await that.signer.signMessage(clientMessage)
                    })
                };
            },

            destroy() {
                return Promise.resolve();
            }
        };
    }

    public createServerFlow(context: AuthContext): AuthServerFlow {
        const challenge = randomBytes(32);
        const prefix = Buffer.from(this.prefixString, 'utf-8');
        const that = this;

        return {
            async receiveInitial(data: ArrayBuffer) {
                const payload = decode(Buffer.from(data));
                if (payload.version !== 1) {
                    console.error(`Invalid payload version ${payload.version} received from client`);

                    return {
                        type: AuthServerReplyType.Reject
                    };
                }

                const serverMessage = createMessage(
                    Buffer.concat([prefix, Buffer.from(arrayify(payload.challenge as any))]),
                    context.remotePublicSecurity,
                );

                return {
                    type: AuthServerReplyType.Data,
                    data: encode({
                        response: await that.signer.signMessage(serverMessage),
                        challenge: hexlify(challenge),
                        version: 1,
                    })
                };
            },

            async receiveData(data) {
                const payload = decode(Buffer.from(data));

                // Calculate what the expected response is and compare them
                const clientMessage = createMessage(Buffer.concat([prefix, challenge]), context.localPublicSecurity);
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
            },

            destroy() {
                return Promise.resolve();
            }
        };
    }
}
