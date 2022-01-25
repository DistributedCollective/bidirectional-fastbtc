import {Writable} from "stream";
import readline from "readline";

/**
 * Password-derived authenticated encryption adapted from
 * https://stackoverflow.com/questions/6953286/how-to-encrypt-data/53573115#53573115
 */

const crypto = require('crypto');

const ALGORITHM = {
    /**
     * GCM is an authenticated encryption mode that
     * not only provides confidentiality but also
     * provides integrity in a secured way
     * */
    BLOCK_CIPHER: 'aes-256-gcm',

    /**
     * 128 bit auth tag is recommended for GCM
     */
    AUTH_TAG_BYTE_LEN: 16,

    /**
     * NIST recommends 96 bits or 12 bytes IV for GCM
     * to promote interoperability, efficiency, and
     * simplicity of design
     */
    IV_BYTE_LEN: 12,

    /**
     * Note: 256 (in algorithm name) is key size.
     * Block size for AES is always 128
     */
    KEY_BYTE_LEN: 32,

    /**
     * To prevent rainbow table attacks
     * */
    SALT_BYTE_LEN: 16
}

const getIV = () => crypto.randomBytes(ALGORITHM.IV_BYTE_LEN);
export function getRandomKey(): Buffer {
    return crypto.randomBytes(ALGORITHM.KEY_BYTE_LEN);
}

/**
 * To prevent rainbow table attacks
 * */
export function createSalt(): Buffer {
    return crypto.randomBytes(ALGORITHM.SALT_BYTE_LEN);
}

/**
 *
 * @param {Buffer} password - The password to be used for generating key
 * @param {Buffer} salt - the salt
 *
 * To be used when key needs to be generated based on password.
 * The caller of this function has the responsibility to clear
 * the Buffer after the key generation to prevent the password
 * from lingering in the memory
 */
export function getKeyFromPassword(password: Buffer, salt: Buffer) {
    return crypto.scryptSync(password, salt, ALGORITHM.KEY_BYTE_LEN);
}

/**
 *
 * @param {Buffer} messageText - The clear text message to be encrypted
 * @param {Buffer} key - The key to be used for encryption
 *
 * The caller of this function has the responsibility to clear
 * the Buffer after the encryption to prevent the message text
 * and the key from lingering in the memory
 */
export function encrypt(messageText: Buffer, key: Buffer) {
    const iv = getIV();
    const cipher = crypto.createCipheriv(
        ALGORITHM.BLOCK_CIPHER, key, iv,
        { 'authTagLength': ALGORITHM.AUTH_TAG_BYTE_LEN });
    let encryptedMessage = cipher.update(messageText);
    encryptedMessage = Buffer.concat([encryptedMessage, cipher.final()]);
    return Buffer.concat([iv, encryptedMessage, cipher.getAuthTag()]);
}

/**
 *
 * @param {Buffer} ciphertext - Cipher text
 * @param {Buffer} key - The key to be used for decryption
 *
 * The caller of this function has the responsibility to clear
 * the Buffer after the decryption to prevent the message text
 * and the key from lingering in the memory
 */
export function decrypt(ciphertext: Buffer, key: Buffer) {
    const authTag = ciphertext.slice(-ALGORITHM.AUTH_TAG_BYTE_LEN);
    const iv = ciphertext.slice(0, ALGORITHM.IV_BYTE_LEN);
    const encryptedMessage = ciphertext.slice(ALGORITHM.IV_BYTE_LEN, -ALGORITHM.AUTH_TAG_BYTE_LEN);
    const decipher = crypto.createDecipheriv(
        ALGORITHM.BLOCK_CIPHER, key, iv,
        { 'authTagLength': ALGORITHM.AUTH_TAG_BYTE_LEN }
    );
    decipher.setAuthTag(authTag);
    let messageText = decipher.update(encryptedMessage);
    messageText = Buffer.concat([messageText, decipher.final()]);
    return messageText;
}

export function encryptSecrets(password: Buffer, secrets: {[key: string]: string}): string {
    const salt: Buffer = createSalt();
    const derivedKey = getKeyFromPassword(password, salt);
    const encryptedSecrets: {[key: string]: string} = {};
    for (const secretName of Object.keys(secrets)) {
        encryptedSecrets[secretName] = encrypt(
            Buffer.from(secrets[secretName], 'utf-8'), derivedKey
        ).toString('hex');
    }
    return JSON.stringify({salt: salt.toString('hex'), encryptedSecrets}, undefined, 4);
}

export function decryptSecrets(password: Buffer, secretContents: string): {[key: string]: string} {
    const secrets: {encryptedSecrets: {[key: string]: string}, salt: string} = JSON.parse(secretContents);
    const salt: Buffer = Buffer.from(secrets.salt, 'hex');
    const derivedKey = getKeyFromPassword(password, salt);
    const decryptedSecrets: {[key: string]: string} = {};
    for (const secretName of Object.keys(secrets.encryptedSecrets)) {
        decryptedSecrets[secretName] = decrypt(
            Buffer.from(secrets.encryptedSecrets[secretName], 'hex'), derivedKey
        ).toString('utf8');
    }
    return decryptedSecrets;
}

export async function promptPassword(prompt: string="Password: "): Promise<string> {
    return new Promise(function (resolve, reject) {
        const mutedStdout = new Writable({
            write: function (chunk, encoding, callback) {
                callback();
            }
        });

        const rl = readline.createInterface({
            input: process.stdin,
            output: mutedStdout,
            terminal: true
        });

        process.stderr.write(prompt);
        rl.question('', function(password) {
            rl.close();
            resolve(password);
        });
    });
}
