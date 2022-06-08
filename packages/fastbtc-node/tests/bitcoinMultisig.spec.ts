import {BitcoinMultisig} from '../src/btc/multisig';
import {BigNumber} from 'ethers';
import BitcoinNodeWrapper, {IBitcoinNodeWrapper} from '../src/btc/nodewrapper';
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
            url: 'http://127.0.0.1:18543/wallet/node1',
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

// NOTE: this was here to test some things in the past. it requires a very specifc setup to work, which is why
// it's marked as skipped
xit("should work", async function () {
    const nodeWrapper = new RegTestNodeWrapper();

    const multiSig = new BitcoinMultisig({
            btcKeyDerivationPath: '0/0',
            numRequiredSigners: 2,
            //btcNetwork: 'regtest',
            //btcRpcUrl: 'http://host.invalid:18333',
            //btcRpcUsername: 'bar',
            secrets: () => ({
                // NOTE: these are test secrets that are supposed to be there. Do not consider them as leaked
                btcRpcPassword: 'foo',
                btcMasterPublicKeys: [
                    'tpubD6NzVbkrYhZ4WokHnVXX8CVBt1S88jkmeG78yWbLxn7Wd89nkNDe2J8b6opP4K38mRwXf9d9VVN5uA58epPKjj584R1rnDDbk6oHUD1MoWD',
                    'tpubD6NzVbkrYhZ4WpZfRZip3ALqLpXhHUbe6UyG8iiTzVDuvNUyysyiUJWejtbszZYrDaUM8UZpjLmHyvtV7r1QQNFmTqciAz1fYSYkw28Ux6y',
                    'tpubD6NzVbkrYhZ4WQZnWqU8ieBsujhoZKZLF6wMvTApJ4ZiGmipk481DyM2su3y5BDeB9fFLwSmmmsGDGJum79he2fnuQMnpWhe3bGir7Mf4uS',
                ],
                btcMasterPrivateKey: 'tprv8ZgxMBicQKsPdLiVtqrvinq5JyvByQZs4xWMgzZ3YWK7ndu27yQ3qoWivh8cgdtB3bKuYKWRKhaEvtykaFCsDCB7akNdcArjgrCnFhuDjmV',
                dbUrl: '',
                rskPrivateKey: '',
            }),
        },
        nodeWrapper,
        {} as any, // STATSD
    );

    await nodeWrapper.call("importaddress", [multiSig.changePayment.address!, '', true, false]);
    await nodeWrapper.generateToAddress(multiSig.changePayment.address!, 101);

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

    // single output encoded differently
    const oneOutput = [
        {btcAddress: randomBech32(), nonce: 1, amountSatoshi: BigNumber.from(100)},
    ];

    const transaction2 = await multiSig.createPartiallySignedTransaction(oneOutput);
    const recoveredOutputs2 = multiSig.getTransactionTransfers(transaction2);

    assert(recoveredOutputs2.length == oneOutput.length, 'recovered output length matches');
    for (const [index, recoveredOut] of recoveredOutputs2.entries()) {
        assert(recoveredOut.btcAddress == oneOutput[index].btcAddress);
        assert(recoveredOut.amountSatoshi.eq(oneOutput[index].amountSatoshi));
        assert(recoveredOut.nonce == oneOutput[index].nonce);
    }
});
