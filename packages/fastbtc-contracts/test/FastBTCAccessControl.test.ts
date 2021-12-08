import {expect} from 'chai';
import {beforeEach, describe, it} from 'mocha';
import {ethers} from 'hardhat';
import {Contract, Signer, utils} from 'ethers';
import exp from 'constants';

describe("FastBTCBridgeAccessControl", function() {
    let accessControl: Contract;
    let ownerAccount: Signer;
    let account1: Signer;
    let account2: Signer;
    let account3: Signer;
    let account4: Signer;
    let ownerAddress: string;
    let address1: string;
    let address2: string;
    let address3: string;
    let address4: string;

    beforeEach(async () => {
        const accounts = await ethers.getSigners();
        ownerAccount = accounts[0];
        ownerAddress = await ownerAccount.getAddress();

        account1 = accounts[1];
        address1 = await account1.getAddress();
        account2 = accounts[2];
        address2 = await account2.getAddress();
        account3 = accounts[3];
        address3 = await account3.getAddress();
        account4 = accounts[4];
        address4 = await account4.getAddress();

        const FastBTCAccessControl = await ethers.getContractFactory("FastBTCAccessControl");
        accessControl = await FastBTCAccessControl.deploy();
    });

    it("#federators is empty at first", async () => {
        expect(await accessControl.federators()).to.deep.equal([]);
    })

    describe('#addFederator', () => {
        it("adds federators when used by admin", async () => {
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

        it("cannot be used by non-admins", async () => {
            await expect(
                accessControl.connect(account1).addFederator('0x0000000000000000000000000000000000000001')
            ).to.be.reverted;
            expect(await accessControl.federators()).to.deep.equal([]);
        });

        it("cannot grant federator role to zero address", async () => {
            await expect(
                accessControl.addFederator('0x0000000000000000000000000000000000000000')
            ).to.be.revertedWith("Cannot grant role to zero address");
            expect(await accessControl.federators()).to.deep.equal([]);
        });
    });

    describe('#removeFederator', () => {
        it("removes federators when used by admin", async () => {
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

        it("cannot be used by non-admins", async () => {
            await accessControl.addFederator('0x0000000000000000000000000000000000000001');
            await expect(
                accessControl.connect(account1).removeFederator('0x0000000000000000000000000000000000000001')
            ).to.be.reverted;
        });
    })

    describe('#checkFederatorSignatures', () => {
        const hash = utils.id('examplemessage');
        const hashBytes = utils.arrayify(hash);

        beforeEach(async () => {
            await accessControl.addFederator(address1);
            await accessControl.addFederator(address2);
            await accessControl.addFederator(address3);
        });

        it("fails when there are no federators", async () => {
            await accessControl.removeFederator(address1);
            await accessControl.removeFederator(address2);
            await accessControl.removeFederator(address3);
            await expect(
                accessControl.checkFederatorSignatures('0x0', [])
            ).to.be.reverted;
        });

        it("works when enough signatures are given", async () => {
            const signatures = [
                await account1.signMessage(hashBytes),
                await account2.signMessage(hashBytes),
            ];

            // should not revert
            await accessControl.checkFederatorSignatures(hash, signatures);

            signatures.push(
                await account3.signMessage(hashBytes),
            );

            // should not revert
            await accessControl.checkFederatorSignatures(hash, signatures);
        });

        it("fails when not enough signatures are given", async () => {
            const signatures = [
                await account1.signMessage(hashBytes),
            ];

            // should not revert
            await expect(
                accessControl.checkFederatorSignatures(hash, signatures)
            ).to.be.reverted;
        });

        it("fails when wrong message is signed", async () => {
            const signatures = [
                await account1.signMessage(hashBytes),
                await account2.signMessage(utils.arrayify(utils.id('examplemessage0'))),
            ];

            await expect(
                accessControl.checkFederatorSignatures(hash, signatures)
            ).to.be.reverted;
        });

        it("fails when message is signed by non-federator", async () => {
            const signatures = [
                await account1.signMessage(hashBytes),
                await account4.signMessage(hashBytes),
            ];

            await expect(
                accessControl.checkFederatorSignatures(hash, signatures)
            ).to.be.reverted;

            signatures.push(
                await account2.signMessage(hashBytes),
            );

            // it will fail even if it has 2 correct signatures, if there's 1 false
            await expect(
                accessControl.checkFederatorSignatures(hash, signatures)
            ).to.be.reverted;
        });

        it("fails when message is signed twice by the same federator", async () => {
            let signatures = [
                await account1.signMessage(hashBytes),
                await account1.signMessage(hashBytes),
            ];

            await expect(
                accessControl.checkFederatorSignatures(hash, signatures)
            ).to.be.revertedWith('already signed by federator');

            signatures = [
                await account1.signMessage(hashBytes),
                await account2.signMessage(hashBytes),
                await account1.signMessage(hashBytes),
            ];

            // it will fail even if it has enough signatures if 2 are the same
            await expect(
                accessControl.checkFederatorSignatures(hash, signatures)
            ).to.be.revertedWith('already signed by federator');
        });
    });

});
