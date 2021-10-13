import {expect} from 'chai';
import {beforeEach, describe, it} from 'mocha';
import {ethers} from 'hardhat';
import {BigNumber, Contract, Signer} from 'ethers';
import {parseEther, parseUnits} from 'ethers/lib/utils';


const TRANSFER_STATUS_NEW = 1; // not 0 to make checks easier
const TRANSFER_STATUS_SENT = 3;
const TRANSFER_STATUS_REFUNDED = -2;

describe("FastBTCBridge", function() {
    let fastBtcBridge: Contract;
    let fastBtcBridgeFromFederator: Contract;
    let accessControl: Contract;
    let btcAddressValidator: Contract;
    let ownerAccount: Signer;
    let anotherAccount: Signer;
    let ownerAddress: string;
    let anotherAddress: string;
    let federators: Signer[];

    beforeEach(async () => {
        const accounts = await ethers.getSigners();
        ownerAccount = accounts[0];
        anotherAccount = accounts[1];
        federators = [
            accounts[2],
            accounts[3],
            accounts[4],
        ]
        ownerAddress = await ownerAccount.getAddress();
        anotherAddress = await anotherAccount.getAddress();

        const FastBTCAccessControl = await ethers.getContractFactory("FastBTCAccessControl");
        accessControl = await FastBTCAccessControl.deploy();

        for (const federator of federators) {
            await accessControl.addFederator(await federator.getAddress());
        }

        const BTCAddressValidator = await ethers.getContractFactory("BTCAddressValidator");
        btcAddressValidator = await BTCAddressValidator.deploy(
            accessControl.address,
            'bc1',
            ['1', '3']
        );

        const FastBTCBridge = await ethers.getContractFactory("FastBTCBridge");
        fastBtcBridge = await FastBTCBridge.deploy(
            accessControl.address,
            btcAddressValidator.address
        );
        await fastBtcBridge.deployed();

        fastBtcBridgeFromFederator = fastBtcBridge.connect(federators[0]);
    });

    const createExampleTransfer = async (
        transferAccount: Signer,
        transferAmount: BigNumber,
        transferBtcAddress: string,
        transferNonce: BigNumber
    ): Promise<string> => {
        await ownerAccount.sendTransaction({
            value: transferAmount,
            to: await transferAccount.getAddress(),
        });
        const transferArgs = [
            transferBtcAddress,
            transferNonce,
        ];
        const transferId = await fastBtcBridge.getTransferId(...transferArgs);
        await fastBtcBridge.connect(transferAccount).transferToBtc(
            ...transferArgs,
            {
                value: transferAmount,
            }
        );
        return transferId;
    }

    it("#isValidBtcAddress", async () => {
        // just test something so we can live in peace
        expect(await fastBtcBridge.isValidBtcAddress("1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2")).to.be.true;
        expect(await fastBtcBridge.isValidBtcAddress("2BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2")).to.be.false;
    });

    it('#getTransferBatchUpdateHash', async () => {
        let updateHash = await fastBtcBridge.getTransferBatchUpdateHash([], TRANSFER_STATUS_SENT);
        expect(updateHash).to.equal('0xfb016b5c356293820d96f52c673dc578c6be65503e2af74a44d2b25feaccb5fd');

        updateHash = await fastBtcBridge.getTransferBatchUpdateHash([], TRANSFER_STATUS_REFUNDED);
        expect(updateHash).to.equal('0x9f2255f1c030ff10f13794ceee5de65ef792a4eae9d0525eb8df1808e6a170d7');
    });

    describe('#transferToRbtc', () => {
        beforeEach(async () => {
            await ownerAccount.sendTransaction({
                value: parseUnits('1', 'ether'),
                to: anotherAddress,
            });
            fastBtcBridge = fastBtcBridge.connect(anotherAccount);
        });

        it('transfers rbtc', async () => {
            const amountEther = parseEther('0.8');

            await expect(
                await fastBtcBridge.transferToBtc(
                    'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
                    0,
                    {
                        value: amountEther,
                    }
                )
            ).to.changeEtherBalances(
                [anotherAccount, fastBtcBridge],
                [amountEther.mul(-1), amountEther]
            );
        });

        it('emits the correct event', async () => {
            const amountEther = parseEther('0.5');
            let amountSatoshi = BigNumber.from(Math.floor(0.5 * 10 ** 8))
            const feeSatoshi = await fastBtcBridge.calculateFeeSatoshi(amountSatoshi);
            amountSatoshi = amountSatoshi.sub(feeSatoshi);

            await expect(
                fastBtcBridge.transferToBtc(
                    'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
                    0,
                    {
                        value: amountEther,
                    }
                )
            ).to.emit(fastBtcBridge, 'NewTransfer').withArgs(
                await fastBtcBridge.getTransferId('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', 0), // bytes32 _transferId,
                'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', // string _btcAddress,
                BigNumber.from(0), // uint _nonce,
                amountSatoshi, // uint _amountSatoshi,
                feeSatoshi, // uint _feeSatoshi,
                anotherAddress, // address _rskAddress
            );
        });

        it('fails if nonce is wrong', async () => {
            const amountEther = parseEther('0.1');

            await expect(
                fastBtcBridge.transferToBtc(
                    'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
                    1,
                    {
                        value: amountEther,
                    }
                )
            ).to.be.reverted;

            await fastBtcBridge.transferToBtc(
                'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
                0,
                {
                    value: amountEther,
                }
            );

            await expect(
                fastBtcBridge.transferToBtc(
                    'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
                    0,
                    {
                        value: amountEther,
                    }
                )
            ).to.be.reverted;
        });
    });

    describe('transfer update methods', () => {
        let transferAmount: BigNumber;
        let transferBtcAddress = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
        let transferNonce = BigNumber.from(0);
        let transferId: string;

        beforeEach(async () => {
            transferAmount = parseEther('0.1');
            transferId = await createExampleTransfer(
                anotherAccount,
                transferAmount,
                transferBtcAddress,
                transferNonce
            );
        });

        describe('#markTransfersAsSent', () => {
            let updateHashBytes: Uint8Array;

            beforeEach(async () => {
                const updateHash = await fastBtcBridge.getTransferBatchUpdateHash([transferId], TRANSFER_STATUS_SENT);
                updateHashBytes = ethers.utils.arrayify(updateHash);
            });

            it('does not mark transfers as sent without signatures', async () => {
                await expect(
                    fastBtcBridgeFromFederator.markTransfersAsSent([transferId], [])
                ).to.be.reverted;
            });

            it('marks transfers as sent if signed by enough federators', async () => {
                let transfer = await fastBtcBridgeFromFederator.getTransfer(transferBtcAddress, transferNonce);
                expect(transfer.status).to.equal(TRANSFER_STATUS_NEW);

                const signatures = [
                    await federators[0].signMessage(updateHashBytes),
                    await federators[1].signMessage(updateHashBytes),
                ];

                await expect(
                    fastBtcBridgeFromFederator.markTransfersAsSent([transferId], signatures)
                ).to.emit(fastBtcBridgeFromFederator, 'TransferStatusUpdated').withArgs(
                    transferId,
                    TRANSFER_STATUS_SENT
                );

                transfer = await fastBtcBridgeFromFederator.getTransfer(transferBtcAddress, transferNonce);
                expect(transfer.status).to.equal(TRANSFER_STATUS_SENT);

                // test idempodency
                await expect(
                    fastBtcBridgeFromFederator.markTransfersAsSent([transferId], signatures)
                ).to.not.emit(fastBtcBridgeFromFederator, 'TransferStatusUpdated');
                transfer = await fastBtcBridgeFromFederator.getTransfer(transferBtcAddress, transferNonce);
                expect(transfer.status).to.equal(TRANSFER_STATUS_SENT);
            });

            it('does not mark transfers as sent if signed by too few federators', async () => {
                const signatures = [
                    await federators[0].signMessage(updateHashBytes),
                ];

                await expect(
                    fastBtcBridgeFromFederator.markTransfersAsSent([transferId], signatures)
                ).to.be.reverted;
            });

            it('does not mark transfers as sent if signed by non-federators', async () => {
                const signatures = [
                    await federators[0].signMessage(updateHashBytes),
                    await anotherAccount.signMessage(updateHashBytes),
                ];

                await expect(
                    fastBtcBridgeFromFederator.markTransfersAsSent([transferId], signatures)
                ).to.be.reverted;
            });

            it('does not mark transfers as sent if wrong hash signed', async () => {
                const signatures = [
                    await federators[0].signMessage(ethers.utils.arrayify(
                        await fastBtcBridgeFromFederator.getTransferBatchUpdateHash([transferId], TRANSFER_STATUS_NEW),
                    )),
                    await federators[1].signMessage(ethers.utils.arrayify(
                        await fastBtcBridgeFromFederator.getTransferBatchUpdateHash([transferId], TRANSFER_STATUS_NEW),
                    )),
                ];

                await expect(
                    fastBtcBridgeFromFederator.markTransfersAsSent([transferId], signatures)
                ).to.be.reverted;
            });
        });

        describe('#refundTransfers', () => {
            let updateSignatures: string[];

            beforeEach(async () => {
                const updateHash = await fastBtcBridge.getTransferBatchUpdateHash(
                    [transferId],
                    TRANSFER_STATUS_REFUNDED
                );
                const updateHashBytes = ethers.utils.arrayify(updateHash);

                updateSignatures = [
                    await federators[0].signMessage(updateHashBytes),
                    await federators[1].signMessage(updateHashBytes),
                ];
            });

            it('refunds transfer', async () => {
                let transfer = await fastBtcBridge.getTransferByTransferId(transferId);
                expect(transfer.status).to.equal(TRANSFER_STATUS_NEW);
                await expect(
                    await fastBtcBridgeFromFederator.refundTransfers([transferId], updateSignatures)
                ).to.changeEtherBalances(
                    [anotherAccount, fastBtcBridge],
                    [transferAmount, transferAmount.mul(-1)]
                );
                transfer = await fastBtcBridge.getTransferByTransferId(transferId);
                expect(transfer.status).to.equal(TRANSFER_STATUS_REFUNDED);
            });

            it('sends events', async () => {
                await expect(
                    await fastBtcBridgeFromFederator.refundTransfers([transferId], updateSignatures)
                ).to.changeEtherBalances(
                    [anotherAccount, fastBtcBridge],
                    [transferAmount, transferAmount.mul(-1)]
                );
            });

            it('does not refund already refunded transfer', async () => {
                await fastBtcBridgeFromFederator.refundTransfers([transferId], updateSignatures);
                await expect(
                    fastBtcBridgeFromFederator.refundTransfers([transferId], updateSignatures)
                ).to.be.reverted;
            });

            it('does not refund sent transfers', async () => {
                const sentHash = await fastBtcBridge.getTransferBatchUpdateHash([transferId], TRANSFER_STATUS_SENT);
                const sentHashBytes = ethers.utils.arrayify(sentHash);
                const sentSignatures = [
                    await federators[0].signMessage(sentHashBytes),
                    await federators[1].signMessage(sentHashBytes),
                ];
                await fastBtcBridgeFromFederator.markTransfersAsSent([transferId], sentSignatures)
                await expect(
                    fastBtcBridgeFromFederator.refundTransfers([transferId], updateSignatures)
                ).to.be.reverted;
            });
        });
    });
});
