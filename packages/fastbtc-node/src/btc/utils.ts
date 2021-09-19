import {Network} from "bitcoinjs-lib";
import b58 from 'bs58check';
import {bip32} from 'bitcoinjs-lib';

const {tprv, tpub, xprv, xpub} = {
    xprv: '0488ade4',
    tprv: '04358394',
    xpub: '0488b21e',
    tpub: '043587cf',
};

// normalize to xpub/xprv/tpub/tprv:
const addressNormalizationTargets: Record<string, string> = {
    xprv: xprv,
    yprv: xprv,
    zprv: xprv,
    Yprv: xprv,
    Zprv: xprv,
    tprv: tprv,
    uprv: tprv,
    vprv: tprv,
    Uprv: tprv,
    Vprv: tprv,
    xpub: xpub,
    ypub: xpub,
    zpub: xpub,
    Ypub: xpub,
    Zpub: xpub,
    tpub: tpub,
    upub: tpub,
    vpub: tpub,
    Upub: tpub,
    Vpub: tpub,
};


export function normalizeKey(key: string): string {
    const originalPrefix = key.slice(0, 4);
    const targetPrefix = addressNormalizationTargets[originalPrefix];
    if (!targetPrefix) {
        throw new Error(`Unknown key prefix ${originalPrefix}`);
    }

    let data = b58.decode(key)
    data = data.slice(4)
    data = Buffer.concat([Buffer.from(targetPrefix, 'hex'), data])
    return b58.encode(data);
}

//export function zpubToXpub(zpub: string): string {
//    let prefix = '0488b21e';
//    if (zpub.startsWith('Vpub')) {
//        // vpub to tpub...
//        prefix = '043587cf';
//    }
//    let data = b58.decode(zpub)
//    data = data.slice(4)
//    data = Buffer.concat([Buffer.from(prefix, 'hex'), data])
//    return b58.encode(data);
//}
//
//export function zprvToXprv(zprv: string): string {
//    let prefix = '0488ade4';
//    if (zprv.startsWith('Vprv')) {
//        // vprv to tprv...
//        prefix = '04358394';
//    }
//    let data = b58.decode(zprv)
//    data = data.slice(4)
//    data = Buffer.concat([Buffer.from(prefix, 'hex'), data])
//    return b58.encode(data);
//}

export function  xprvToPublic(xprv: string, network: Network): string {
    return bip32.fromBase58(xprv, network).neutered().toBase58()
}
