/**
 * Example token tests
 *
 * The token is just a simple extension of OpenZeppelin ERC20.sol,
 * as outlined in https://docs.openzeppelin.com/contracts/4.x/erc20
 *
 * So these tests need not test very much.
 */
import {expect} from 'chai';
import {beforeEach, describe, it} from 'mocha';
import {ethers} from 'hardhat';
import {Contract, Signer} from 'ethers';

describe("FastBTCBridgeAccessControl", function() {
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

        const FastBTCAccessControl = await ethers.getContractFactory("FastBTCAccessControl");
        accessControl = await FastBTCAccessControl.deploy();
    });

    it("#federators is empty at first", async () => {
        expect(await accessControl.federators()).to.deep.equal([]);
    })

    it("#addFederator adds federators when used by admin", async () => {
        await accessControl.addFederator('0x0000000000000000000000000000000000000001');
        expect(await accessControl.federators()).to.deep.equal(['0x0000000000000000000000000000000000000001']);
        await accessControl.addFederator('0x0000000000000000000000000000000000000001');
        expect(await accessControl.federators()).to.deep.equal(['0x0000000000000000000000000000000000000001']);
        await accessControl.addFederator('0x0000000000000000000000000000000000000002');
        expect(await accessControl.federators()).to.deep.equal([
            '0x0000000000000000000000000000000000000001',
            '0x0000000000000000000000000000000000000002',
        ]);
    });

    it("#addFederator cannot be used by non-admins", async () => {
        await expect(
            accessControl.connect(anotherAccount).addFederator('0x0000000000000000000000000000000000000001')
        ).to.be.reverted;
        expect(await accessControl.federators()).to.deep.equal([]);
    });

    it("#removeFederator removes federators when used by admin", async () => {
        await accessControl.addFederator('0x0000000000000000000000000000000000000001');
        await accessControl.addFederator('0x0000000000000000000000000000000000000002');
        expect(await accessControl.federators()).to.deep.equal([
            '0x0000000000000000000000000000000000000001',
            '0x0000000000000000000000000000000000000002',
        ]);
        await accessControl.removeFederator('0x0000000000000000000000000000000000000002');
        expect(await accessControl.federators()).to.deep.equal(['0x0000000000000000000000000000000000000001']);
        await accessControl.removeFederator('0x0000000000000000000000000000000000000001');
        expect(await accessControl.federators()).to.deep.equal([]);
        await accessControl.removeFederator('0x0000000000000000000000000000000000000001');  // no-op tx
        expect(await accessControl.federators()).to.deep.equal([]);
    });

    it("#removeFederator cannot be used by non-admins", async () => {
        await accessControl.addFederator('0x0000000000000000000000000000000000000001');
        await expect(
            accessControl.connect(anotherAccount).removeFederator('0x0000000000000000000000000000000000000001')
        ).to.be.reverted;
    });
});
