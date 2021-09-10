/**
 * Example token tests
 *
 * The token is just a simple extension of OpenZeppelin ERC20.sol,
 * as outlined in https://docs.openzeppelin.com/contracts/4.x/erc20
 *
 * So these tests need not test very much.
 */
import {expect} from 'chai';
import {describe, it, beforeEach} from 'mocha';
import {ethers} from 'hardhat';
import {Contract, Signer, utils} from 'ethers';

const {parseEther} = utils;

describe("FastBTCBridge", function() {
  let fastBtcBridge: Contract;
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

    const FastBTCBridge = await ethers.getContractFactory("FastBTCBridge");
    fastBtcBridge = await FastBTCBridge.deploy();
    await fastBtcBridge.deployed();
  });

  it("#isValidBtcAddress", async () => {
      // must start with 1 or 3
      expect(await fastBtcBridge.isValidBtcAddress("1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2")).to.be.true;
      expect(await fastBtcBridge.isValidBtcAddress("2BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2")).to.be.false;
      expect(await fastBtcBridge.isValidBtcAddress("3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy")).to.be.true;
      expect(await fastBtcBridge.isValidBtcAddress("ABvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2")).to.be.false;

      // cannot contain 0, O, I, or l
      expect(await fastBtcBridge.isValidBtcAddress("10vBMSEYstWetqTFn5Au4m4GFg7xJaNVN2")).to.be.false;
      expect(await fastBtcBridge.isValidBtcAddress("1OvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2")).to.be.false;
      expect(await fastBtcBridge.isValidBtcAddress("1IvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2")).to.be.false;
      expect(await fastBtcBridge.isValidBtcAddress("1lvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2")).to.be.false;

      // cannot contain special characters
      expect(await fastBtcBridge.isValidBtcAddress("1BvBMSEYst:etqTFn5Au4m4GFg7xJaNVN2")).to.be.false;

      // length between 26 and 35
      expect(await fastBtcBridge.isValidBtcAddress("1BvBMSEYstWetqTFn5Au4m4GFg")).to.be.true;
      expect(await fastBtcBridge.isValidBtcAddress("1BvBMSEYstWetqTFn5Au4m4GF")).to.be.false;
      expect(await fastBtcBridge.isValidBtcAddress("1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2A")).to.be.true;
      expect(await fastBtcBridge.isValidBtcAddress("1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2AA")).to.be.false;

      // TODO: test configurable prefixes, bech32 and whatnot
  });
});
