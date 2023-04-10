import {expect} from 'chai';
import {beforeEach, describe, it} from 'mocha';
import {ethers} from 'hardhat';
import {BigNumber, Contract, Signer} from 'ethers';
import {parseEther} from 'ethers/lib/utils';
import { setNextBlockTimestamp } from './utils';


const TRANSFER_STATUS_SENDING = 2;
const ZERO = BigNumber.from('0')
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
            await expect(withdrawer.withdrawRbtcToReceiver(ZERO)).to.be.revertedWith(
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
