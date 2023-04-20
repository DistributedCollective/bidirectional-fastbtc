import {expect} from 'chai';
import {beforeEach, describe, it} from 'mocha';
import {ethers} from 'hardhat';
import {BigNumber, Contract, Signer} from 'ethers';
import {parseEther} from 'ethers/lib/utils';
import { setNextBlockTimestamp } from './utils';


const TRANSFER_STATUS_SENDING = 2;
const ONE_BTC_IN_SATOSHI = BigNumber.from('10').pow('8');
const ONE_SATOSHI_IN_WEI = parseEther('1').div(ONE_BTC_IN_SATOSHI);


describe("Withdrawer", function() {
    let withdrawer: Contract;
    let fastBtcBridge: Contract;
    let accessControl: Contract;
    let ownerAccount: Signer;
    let anotherAccount: Signer;
    let ownerAddress: string;
    let anotherAddress: string;
    let federators: Signer[];
    let receiverAccount: Signer;
    let receiverAddress: string;

    beforeEach(async () => {
        const accounts = await ethers.getSigners();
        ownerAccount = accounts[0];
        anotherAccount = accounts[1];
        federators = [
            accounts[2],
            accounts[3],
            accounts[4],
        ]
        receiverAccount = accounts[5];

        ownerAddress = await ownerAccount.getAddress();
        anotherAddress = await anotherAccount.getAddress();
        receiverAddress = await receiverAccount.getAddress();

        const FastBTCAccessControl = await ethers.getContractFactory("FastBTCAccessControl");
        accessControl = await FastBTCAccessControl.deploy();

        for (const federator of federators) {
            await accessControl.addFederator(await federator.getAddress());
        }

        const BTCAddressValidator = await ethers.getContractFactory("BTCAddressValidator");
        const btcAddressValidator = await BTCAddressValidator.deploy(
            accessControl.address,
            'bc1',
            ['1', '3']
        );

        const FastBTCBridge = await ethers.getContractFactory("FastBTCBridge");
        fastBtcBridge = await FastBTCBridge.deploy(
            accessControl.address,
            btcAddressValidator.address,
        );
        await fastBtcBridge.deployed();
        await fastBtcBridge.setMaxTransferSatoshi(ONE_BTC_IN_SATOSHI.mul('100'));

        const Withdrawer = await ethers.getContractFactory("Withdrawer");
        withdrawer = await Withdrawer.deploy(
            fastBtcBridge.address,
            receiverAddress,
        );
        await withdrawer.deployed();

        // we connect it to the federator as that's the most common case
        withdrawer = withdrawer.connect(federators[0]);

        // we add it as admin by default, as intended, because it simplifies other tests
        await accessControl.grantRole(await accessControl.ROLE_ADMIN(), withdrawer.address);
    });

    describe("#withdrawRbtcToReceiver", () => {
        let maxWithdrawable: BigNumber;

        beforeEach(async () => {
            maxWithdrawable = await withdrawer.maxWithdrawable();
            await fundFastBtcBridge(maxWithdrawable.add(ONE_SATOSHI_IN_WEI));
        });

        it('will withdraw up to maxWithdrawable', async () => {
            const receiverBalanceBefore = await ethers.provider.getBalance(receiverAddress);
            const fastBtcBridgeBalanceBefore = await ethers.provider.getBalance(fastBtcBridge.address);

            const amount = maxWithdrawable;
            await expect(
                withdrawer.withdrawRbtcToReceiver(
                    amount,
                )
            ).to.emit(withdrawer, 'Withdrawal').withArgs(
                amount,
            );

            const receiverBalanceAfter = await ethers.provider.getBalance(receiverAddress);
            const fastBtcBridgeBalanceAfter = await ethers.provider.getBalance(fastBtcBridge.address);

            expect(receiverBalanceAfter.sub(receiverBalanceBefore)).to.equal(amount);
            expect(fastBtcBridgeBalanceAfter.sub(fastBtcBridgeBalanceBefore)).to.equal(amount.mul('-1'));
        });

        it('cannot withdraw zero amount', async () => {
            await expect(withdrawer.withdrawRbtcToReceiver(0)).to.be.revertedWith(
                'cannot withdraw zero amount'
            );
        });

        it('cannot withdraw more than maxWithdrawable', async () => {
            await expect(withdrawer.withdrawRbtcToReceiver(
                maxWithdrawable.add('1'))
            ).to.be.revertedWith(
                'amount too high'
            );
        });

        it('can withdraw again only after minTimeBetweenWithdrawals has passed', async () => {
            const receiverBalanceBefore = await ethers.provider.getBalance(receiverAddress);
            const fastBtcBridgeBalanceBefore = await ethers.provider.getBalance(fastBtcBridge.address);

            let amount = parseEther('1');
            await expect(
                withdrawer.withdrawRbtcToReceiver(
                    amount,
                )
            ).to.emit(withdrawer, 'Withdrawal').withArgs(
                amount,
            );

            const currentTimestamp = (await ethers.provider.getBlock('latest')).timestamp;

            let receiverBalanceAfter = await ethers.provider.getBalance(receiverAddress);
            let fastBtcBridgeBalanceAfter = await ethers.provider.getBalance(fastBtcBridge.address);

            expect(receiverBalanceAfter.sub(receiverBalanceBefore)).to.equal(amount);
            expect(fastBtcBridgeBalanceAfter.sub(fastBtcBridgeBalanceBefore)).to.equal(amount.mul('-1'));

            await expect(
                withdrawer.withdrawRbtcToReceiver(
                    amount
                )
            ).to.be.revertedWith(
                'too soon'
            );

            const minTimeBetweenWithdrawals = await withdrawer.minTimeBetweenWithdrawals();
            await setNextBlockTimestamp(minTimeBetweenWithdrawals.add(currentTimestamp));

            await withdrawer.withdrawRbtcToReceiver(
                amount,
            );

            receiverBalanceAfter = await ethers.provider.getBalance(receiverAddress);
            fastBtcBridgeBalanceAfter = await ethers.provider.getBalance(fastBtcBridge.address);
            expect(receiverBalanceAfter.sub(receiverBalanceBefore)).to.equal(amount.mul('2'));
            expect(fastBtcBridgeBalanceAfter.sub(fastBtcBridgeBalanceBefore)).to.equal(amount.mul('-2'));
        });

        it('only a federator can withdraw', async () => {
            const amount = parseEther('0.123')

            await expect(
                withdrawer.connect(ownerAccount).withdrawRbtcToReceiver(
                    amount
                )
            ).to.be.reverted;

            await expect(
                withdrawer.connect(anotherAccount).withdrawRbtcToReceiver(
                    amount
                )
            ).to.be.reverted;

            // no revert here:
            await withdrawer.connect(federators[1]).withdrawRbtcToReceiver(
                amount
            );
        });
    });

    describe('#setMaxWithdrawable', () => {
        it('only admin can set maxWithdrawable', async () => {
            await expect(withdrawer.connect(federators[0]).setMaxWithdrawable(parseEther('1'))).to.be.reverted;
            await expect(withdrawer.connect(anotherAccount).setMaxWithdrawable(parseEther('1'))).to.be.reverted;
            await expect(withdrawer.connect(ownerAccount).setMaxWithdrawable(parseEther('1'))).to.not.be.reverted;
        });

        it('can set maxWithdrawable to zero', async () => {
            await expect(withdrawer.connect(ownerAccount).setMaxWithdrawable(0)).to.not.be.reverted;
        });

        it('calling changes maxWithdrawable', async () => {
            const amount = parseEther('1.2345');
            await withdrawer.connect(ownerAccount).setMaxWithdrawable(amount);
            expect(await withdrawer.maxWithdrawable()).to.equal(amount);
        });

        it('calling emits the MaxWithdrawableUpdated event', async () => {
            const amount = parseEther('1.2345');
            await expect(
                withdrawer.connect(ownerAccount).setMaxWithdrawable(amount)
            ).to.emit(withdrawer, 'MaxWithdrawableUpdated').withArgs(amount);
        });
    });

    describe('#setMinTimeBetweenWithdrawals', () => {
        // same tests as above, basicallydd
        it('only admin can set minTimeBetweenWithdrawals', async () => {
            await expect(withdrawer.connect(federators[0]).setMinTimeBetweenWithdrawals(1)).to.be.reverted;
            await expect(withdrawer.connect(anotherAccount).setMinTimeBetweenWithdrawals(1)).to.be.reverted;
            await expect(withdrawer.connect(ownerAccount).setMinTimeBetweenWithdrawals(1)).to.not.be.reverted;
        });

        it('can set minTimeBetweenWithdrawals to zero', async () => {
            await expect(withdrawer.connect(ownerAccount).setMinTimeBetweenWithdrawals(0)).to.not.be.reverted;
        });

        it('calling changes minTimeBetweenWithdrawals', async () => {
            const time = 12345;
            await withdrawer.connect(ownerAccount).setMinTimeBetweenWithdrawals(time);
            expect(await withdrawer.minTimeBetweenWithdrawals()).to.equal(time);
        });

        it('calling emits the MinTimeBetweenWithdrawalsUpdated event', async () => {
            const time = 12345;
            await expect(
                withdrawer.connect(ownerAccount).setMinTimeBetweenWithdrawals(time)
            ).to.emit(withdrawer, 'MinTimeBetweenWithdrawalsUpdated').withArgs(time);
        });
    });

    describe('#hasWithdrawPermissions', () => {
        it('returns true if the contract is an admin of FastBTCBridge', async () => {
            expect(await withdrawer.hasWithdrawPermissions()).to.be.true;
        });

        it('returns false if the contract is not an admin of FastBTCBridge', async () => {
            await accessControl.connect(ownerAccount).revokeRole(
                await accessControl.ROLE_ADMIN(),
                withdrawer.address,
            );
            expect(await withdrawer.hasWithdrawPermissions()).to.be.false;
        });
    });

    describe('#nextPossibleWithdrawTimestamp', () => {
        it('is initially minTimeBetweenWithdrawals', async () => {
            const minTimeBetweenWithdrawals = await withdrawer.minTimeBetweenWithdrawals();
            expect(await withdrawer.nextPossibleWithdrawTimestamp()).to.equal(minTimeBetweenWithdrawals);
        });

        it('increases after a withdrawal', async () => {
            const amount = parseEther('0.12345');
            await fundFastBtcBridge(amount);
            const result = await withdrawer.withdrawRbtcToReceiver(amount);

            const block = await ethers.provider.getBlock(result.blockNumber);
            const minTimeBetweenWithdrawals = await withdrawer.minTimeBetweenWithdrawals();

            expect(await withdrawer.nextPossibleWithdrawTimestamp()).to.equal(block.timestamp + minTimeBetweenWithdrawals.toNumber());
        });
    });

    describe('#receiverBalance', () => {
        it('returns the balance of the receiver', async () => {
            await ownerAccount.sendTransaction({
                to: receiverAddress,
                value: parseEther('0.12345'),
            });
            expect(await withdrawer.receiverBalance()).to.equal(await receiverAccount.getBalance());
        });

    });

    describe('#amountWithdrawable', () => {
        it('returns totalAdminWithdrawableRbtc if everything is ok and the method is supported by FastBTCBridge', async () => {
            const excessBalance = parseEther('10');

            await ethers.provider.send('hardhat_setBalance', [
                fastBtcBridge.address,
                excessBalance.toHexString(),
            ]);

            expect(await fastBtcBridge.totalAdminWithdrawableRbtc()).to.equal(0);
            expect(await withdrawer.amountWithdrawable()).to.equal(0);

            const expectedWithdrawableAmount = parseEther('1.337');
            await fundFastBtcBridge(expectedWithdrawableAmount);

            expect(await fastBtcBridge.totalAdminWithdrawableRbtc()).to.equal(expectedWithdrawableAmount);

            expect(await ethers.provider.getBalance(fastBtcBridge.address)).to.equal(
                expectedWithdrawableAmount.add(excessBalance)
            );
            expect(await withdrawer.amountWithdrawable()).to.equal(expectedWithdrawableAmount);
        });

        it('returns contract balance if everything is ok but totalAdminWithdrawableRbtc is not supported by FastBTCBridge', async () => {
            const Withdrawer = await ethers.getContractFactory("Withdrawer");

            // This bears some explanation: `Withdrawer` is a `FastBTCAccessControllable` contract itself,
            // so it has the `accessControl` method that points to the correct `FastBTCAccessControl` instance.
            // That means we can pretend that the previous `Withdrawer` instance is the `FastBTCBridge` contract,
            // as far as the constructor or the newly deployed `Withdrawer` is concerned.
            // Naturally, `Withdrawer` does not have the `totalAdminWithdrawableRbtc` function, so we can
            // test this edge case here.
            const fakeFastBtcBridge = withdrawer;
            const newWithdrawer = await Withdrawer.deploy(
                fakeFastBtcBridge.address,
                receiverAddress,
            );
            await accessControl.grantRole(await accessControl.ROLE_ADMIN(), newWithdrawer.address);

            const contractBalance = parseEther('10');

            await ethers.provider.send('hardhat_setBalance', [
                fakeFastBtcBridge.address,
                contractBalance.toHexString(),
            ]);

            expect(await newWithdrawer.amountWithdrawable()).to.equal(contractBalance);
        });

        it('returns 0 if the contract does not have withdraw permissions', async () => {
            await fundFastBtcBridge(parseEther('1.2345'));
            await accessControl.connect(ownerAccount).revokeRole(
                await accessControl.ROLE_ADMIN(),
                withdrawer.address,
            );
            expect(await withdrawer.amountWithdrawable()).to.equal(0);
        });

        it('returns 0 if enough time has not passed from the last withdrawal', async () => {
            const amount = parseEther('0.1');

            await fundFastBtcBridge(amount);
            await withdrawer.withdrawRbtcToReceiver(amount.div(2));

            expect(await withdrawer.amountWithdrawable()).to.equal(0);
        });
    });

    async function fundFastBtcBridge(
        amount: BigNumber
    ): Promise<void> {
        const transferId = await createExampleTransfer(
            anotherAccount,
            amount,
            'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'
        );

        const btcTxHash: string = '0x6162636465666768696a6b6c6d6e6f707172737475767778797a414243444546';
        const updateHash = await fastBtcBridge.getTransferBatchUpdateHashWithTxHash(
            btcTxHash,
            [transferId],
            TRANSFER_STATUS_SENDING
        );
        const updateHashBytes = ethers.utils.arrayify(updateHash);
        const signatures = [
            await federators[0].signMessage(updateHashBytes),
            await federators[1].signMessage(updateHashBytes),
        ];

        await fastBtcBridge.connect(federators[0]).markTransfersAsSending(
            btcTxHash,
            [transferId],
            signatures
        )
    }

    async function createExampleTransfer(
        transferAccount: Signer,
        transferAmount: BigNumber,
        transferBtcAddress: string,
    ): Promise<string> {
        await ownerAccount.sendTransaction({
            value: transferAmount,
            to: await transferAccount.getAddress(),
        });
        const nonce = await fastBtcBridge.getNextNonce(transferBtcAddress);
        await fastBtcBridge.connect(transferAccount).transferToBtc(
            transferBtcAddress,
            {
                value: transferAmount,
            }
        );

        return await fastBtcBridge.getTransferId(transferBtcAddress, nonce);
    }
});
