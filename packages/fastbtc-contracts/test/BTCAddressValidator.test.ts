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
        btcAddressValidator = await BTCAddressValidator.deploy(accessControl.address);
    });

    it("#isValidBtcAddress", async () => {
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

    // TODO: test configurable prefixes, bech32 and whatnot
});
