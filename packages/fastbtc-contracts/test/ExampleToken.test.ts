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

describe("ExampleToken", function() {
  let exampleToken: Contract;
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

    const ExampleToken = await ethers.getContractFactory("ExampleToken");
    exampleToken = await ExampleToken.deploy();
    await exampleToken.deployed();
  });

  it("totalSupply", async () => {
    const expectedTotalSupply = parseEther('10 000 000 000'.replace(/ /g, ''));
    expect(await exampleToken.totalSupply()).to.be.equal(expectedTotalSupply);
    expect(await exampleToken.balanceOf(ownerAddress)).to.be.equal(expectedTotalSupply);
  });

  it("symbol", async () => {
    expect(await exampleToken.symbol()).to.be.equal('XMPL');
  });

  it("name", async () => {
    expect(await exampleToken.name()).to.be.equal('Example');
  });

  it("decimals", async () => {
    expect(await exampleToken.decimals()).to.be.equal(18);
  });
});
