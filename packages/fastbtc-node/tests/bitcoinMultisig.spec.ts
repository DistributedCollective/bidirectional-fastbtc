import {BitcoinMultisig} from '../src/btc/multisig';
import {BigNumber} from 'ethers';
import BitcoinNodeWrapper, {IBitcoinNodeWrapper} from '../src/btc/nodewrapper';
import {RegtestUtils} from 'regtest-client';
import {ECPair, Network, networks, payments} from 'bitcoinjs-lib';
import assert from 'assert';

function randomBech32(): string {
    const keyPair = ECPair.makeRandom({network: networks.regtest});
    const {address} = payments.p2wpkh({pubkey: keyPair.publicKey, network: networks.regtest});
    return address!;
}

class RegTestNodeWrapper implements IBitcoinNodeWrapper {
    public readonly network: Network;
    private nodeWrapper: IBitcoinNodeWrapper;

    constructor() {
        this.network = networks.regtest;
        this.nodeWrapper = new BitcoinNodeWrapper({
            url: 'http://127.0.0.1:18543/1',
            user: 'fastbtc',
            password: 'hunter2',
            btcNetwork: 'regtest',
        });
    }

    async call(method: string, params: any = null): Promise<any> {
        console.log("call:", method, params);
        return this.nodeWrapper.call(method, params);
    }

    async getLastBlock(): Promise<number | undefined> {
        return this.nodeWrapper.getLastBlock();
    }

    async generateToAddress(address: string, blocks: number): Promise<any> {
        return this.call('generatetoaddress', [blocks, address]);
    }
}

it("random regtest addresses should start with bcrt...", async function () {
    assert(randomBech32().startsWith(networks.regtest.bech32), "prefix should match!");
})

it("should work", async function () {
    const nodeWrapper = new RegTestNodeWrapper();

    const multiSig = new BitcoinMultisig({
            btcKeyDerivationPath: '0/0',
            btcMasterPublicKeys: [
                'tpubD6NzVbkrYhZ4WokHnVXX8CVBt1S88jkmeG78yWbLxn7Wd89nkNDe2J8b6opP4K38mRwXf9d9VVN5uA58epPKjj584R1rnDDbk6oHUD1MoWD',
                'tpubD6NzVbkrYhZ4WpZfRZip3ALqLpXhHUbe6UyG8iiTzVDuvNUyysyiUJWejtbszZYrDaUM8UZpjLmHyvtV7r1QQNFmTqciAz1fYSYkw28Ux6y',
                'tpubD6NzVbkrYhZ4WQZnWqU8ieBsujhoZKZLF6wMvTApJ4ZiGmipk481DyM2su3y5BDeB9fFLwSmmmsGDGJum79he2fnuQMnpWhe3bGir7Mf4uS',
            ],
            btcMasterPrivateKey: 'tprv8ZgxMBicQKsPdLiVtqrvinq5JyvByQZs4xWMgzZ3YWK7ndu27yQ3qoWivh8cgdtB3bKuYKWRKhaEvtykaFCsDCB7akNdcArjgrCnFhuDjmV',
            btcNetwork: 'regtest',
            btcRpcUrl: 'http://host.invalid:18333',
            btcRpcPassword: 'foo',
            btcRpcUsername: 'bar',
        },
        nodeWrapper,
    );

    await nodeWrapper.call("importaddress", [multiSig.payoutScript.address!, '', true, false]);
    await nodeWrapper.generateToAddress(multiSig.payoutScript.address!, 101);

    const outputs = [
        {btcAddress: randomBech32(), nonce: 42, amountSatoshi: BigNumber.from(100)},
        {btcAddress: randomBech32(), nonce: 33, amountSatoshi: BigNumber.from(200)},
    ];

    const transaction = await multiSig.createPartiallySignedTransaction(outputs);
    const recoveredOutputs = multiSig.getTransactionTransfers(transaction);

    assert(recoveredOutputs.length == outputs.length, 'recovered output length matches');
    for (const [index, recoveredOut] of recoveredOutputs.entries()) {
        assert(recoveredOut.btcAddress == outputs[index].btcAddress);
        assert(recoveredOut.amountSatoshi.eq(outputs[index].amountSatoshi));
        assert(recoveredOut.nonce == outputs[index].nonce);
    }
});
