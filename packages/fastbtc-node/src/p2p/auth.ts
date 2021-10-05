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
    peerAddresses: string[],
    signer: ethers.Signer
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
    private readonly peerAddresses: string[];

    public constructor(options: RSKKeyedAuthOptions) {
        this.signer = options.signer;
        this.peerAddresses = options.peerAddresses;
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
                    return {
                        type: AuthClientReplyType.Reject
                    };
                }

                const serverChallenge: Buffer = Buffer.from(arrayify(payload.challenge as any));
                const serverResponse: string = payload.response as any;

                const serverMessage = createMessage(Buffer.concat([prefix, challenge]), context.remotePublicSecurity);
                const recoveredAddress = ethers.utils.verifyMessage(ethers.utils.arrayify(serverMessage), serverResponse);

                if (that.peerAddresses.indexOf(recoveredAddress as any) === -1) {
                    return {
                        type: AuthClientReplyType.Reject
                    };
                }

                const clientMessage = createMessage(Buffer.concat([prefix, serverChallenge]), context.localPublicSecurity);

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

                if (that.peerAddresses.indexOf(recoveredAddress as any) === -1) {
                    return {
                        type: AuthServerReplyType.Reject
                    };
                }

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
