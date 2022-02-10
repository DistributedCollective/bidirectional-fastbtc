import {expect} from 'chai';
import {beforeEach, describe, it} from 'mocha';
import {ethers} from 'hardhat';
import {Contract, Signer} from 'ethers';

describe("BTCAddressValidator", function() {
    let btcAddressValidator: Contract;
    let accessControl: Contract;
    let ownerAccount: Signer;
    let anotherAccount: Signer;
    let ownerAddress: string;
    let anotherAddress: string;

    beforeEach(async () => {
        const accounts = await ethers.getSigners();
        ownerAccount = accounts[0];
        anotherAccount = accounts[1];
        ownerAddress = await ownerAccount.getAddress();
        anotherAddress = await anotherAccount.getAddress();

        // Could deploy faux access control too, but whatever
        const FastBTCAccessControl = await ethers.getContractFactory("FastBTCAccessControl");
        accessControl = await FastBTCAccessControl.deploy();

        const BTCAddressValidator = await ethers.getContractFactory("BTCAddressValidator");
        // add mainnet-compatible config here at first
        btcAddressValidator = await BTCAddressValidator.deploy(
            accessControl.address,
            "bc1q",  // bech32 prefix, segwit version 0
            ["1", "3"],  // non-bech32 prefixes
        );
    });

    describe("#isValidBtcAddress", () => {
        it("tests legacy addresses", async () => {
            // must start with 1 or 3
            expect(await btcAddressValidator.isValidBtcAddress("1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2")).to.be.true;
            expect(await btcAddressValidator.isValidBtcAddress("2BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2")).to.be.false;
            expect(await btcAddressValidator.isValidBtcAddress("3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy")).to.be.true;
            expect(await btcAddressValidator.isValidBtcAddress("ABvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2")).to.be.false;

            // cannot contain 0, O, I, or l
            expect(await btcAddressValidator.isValidBtcAddress("10vBMSEYstWetqTFn5Au4m4GFg7xJaNVN2")).to.be.false;
            expect(await btcAddressValidator.isValidBtcAddress("1OvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2")).to.be.false;
            expect(await btcAddressValidator.isValidBtcAddress("1IvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2")).to.be.false;
            expect(await btcAddressValidator.isValidBtcAddress("1lvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2")).to.be.false;

            // cannot contain special characters
            expect(await btcAddressValidator.isValidBtcAddress("1BvBMSEYst:etqTFn5Au4m4GFg7xJaNVN2")).to.be.false;

            // length between 26 and 35
            expect(await btcAddressValidator.isValidBtcAddress("1BvBMSEYstWetqTFn5Au4m4GFg")).to.be.true;
            expect(await btcAddressValidator.isValidBtcAddress("1BvBMSEYstWetqTFn5Au4m4GF")).to.be.false;
            expect(await btcAddressValidator.isValidBtcAddress("1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2A")).to.be.true;
            expect(await btcAddressValidator.isValidBtcAddress("1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2AA")).to.be.false;
        });

        it("validates bech32 addresses", async () => {
            expect(await btcAddressValidator.isValidBtcAddress("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4")).to.be.true;
            // bech32 must not contain 1, b, i, o
            expect(await btcAddressValidator.isValidBtcAddress("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t1")).to.be.false;
            expect(await btcAddressValidator.isValidBtcAddress("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3tb")).to.be.false;
            expect(await btcAddressValidator.isValidBtcAddress("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3ti")).to.be.false;
            expect(await btcAddressValidator.isValidBtcAddress("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3to")).to.be.false;

            // wrong character w.r.t. prefix
            expect(await btcAddressValidator.isValidBtcAddress("bc1pw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3to")).to.be.false;

            // we don't allow upper case
            expect(await btcAddressValidator.isValidBtcAddress("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4".toUpperCase())).to.be.false;
            expect(await btcAddressValidator.isValidBtcAddress("bc1q" + ("w508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4".toUpperCase()))).to.be.false;
        })
    })

    // TODO:
    // - configurable prefixes
    // - lengths
    // - admin methods
    // - more bech32 tests
});
