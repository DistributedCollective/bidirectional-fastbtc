import {expect} from 'chai';
import {beforeEach, describe, it} from 'mocha';
import {ethers} from 'hardhat';
import {BigNumber, Contract, Signer} from 'ethers';
import {parseEther, parseUnits} from 'ethers/lib/utils';


const TRANSFER_STATUS_NOT_APPLICABLE = 0;
const TRANSFER_STATUS_NEW = 1; // not 0 to make checks easier
const TRANSFER_STATUS_SENT = 2;
const TRANSFER_STATUS_MINED = 3;
const TRANSFER_STATUS_REFUNDED = 4;
const TRANSFER_STATUS_RECLAIMED = 5;

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

    async function mineToBlock(targetBlock: number) {
        while (await ethers.provider.getBlockNumber() < targetBlock) {
            await ethers.provider.send('evm_mine', []);
        }
    }

    it("#isValidBtcAddress", async () => {
        // just test something so we can live in peace
        expect(await fastBtcBridge.isValidBtcAddress("1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2")).to.be.true;
        expect(await fastBtcBridge.isValidBtcAddress("2BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2")).to.be.false;
    });

    it('#getTransferBatchUpdateHash', async () => {
        let updateHash = await fastBtcBridge.getTransferBatchUpdateHash([], TRANSFER_STATUS_SENT);
        expect(updateHash).to.equal('0x849e7c1bf1eaa72e3d54ccafe4e31a87e7fdf91fadde443e59d6e7a4dc7bbf89');

        updateHash = await fastBtcBridge.getTransferBatchUpdateHash([], TRANSFER_STATUS_MINED);
        expect(updateHash).to.equal('0xade6aa218b6b5b2b24c9d124f1354d1433129799b4f057da7fac270110173526');

        updateHash = await fastBtcBridge.getTransferBatchUpdateHash([], TRANSFER_STATUS_REFUNDED);
        expect(updateHash).to.equal('0x407f4d1873d801d54d66816813e572aa318e59136d8e1e663a1c554352ba3772');
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
            const feeSatoshi = await fastBtcBridge.calculateCurrentFeeSatoshi(amountSatoshi);
            amountSatoshi = amountSatoshi.sub(feeSatoshi);

            await expect(
                fastBtcBridge.transferToBtc(
                    'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
                    {
                        value: amountEther,
                    }
                )
            ).to.emit(fastBtcBridge, 'NewBitcoinTransfer').withArgs(
                await fastBtcBridge.getTransferId('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', 0), // bytes32 _transferId,
                'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', // string _btcAddress,
                BigNumber.from(0), // uint _nonce,
                amountSatoshi, // uint _amountSatoshi,
                feeSatoshi, // uint _feeSatoshi,
                anotherAddress, // address _rskAddress
            );
        });

        it('nonces increase', async () => {
            const amountEther = parseEther('0.1');
            let amountSatoshi = amountEther.div(BigNumber.from(Math.floor(10 ** 18 / 10 ** 8)));
            const feeSatoshi = await fastBtcBridge.calculateCurrentFeeSatoshi(amountSatoshi);

            amountSatoshi = amountSatoshi.sub(feeSatoshi);

            await expect(
                fastBtcBridge.transferToBtc(
                    'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
                    {
                        value: amountEther,
                    }
                )
            ).to.emit(fastBtcBridge, 'NewBitcoinTransfer').withArgs(
                await fastBtcBridge.getTransferId('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', 0), // bytes32 transferId,
                'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', // string btcAddress,
                BigNumber.from(0), // uint nonce,
                amountSatoshi, // uint amountSatoshi,
                feeSatoshi, // uint feeSatoshi,
                anotherAddress, // address rskAddress
            );

            await expect(
                fastBtcBridge.transferToBtc(
                    'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
                    {
                        value: amountEther,
                    }
                )
            ).to.emit(fastBtcBridge, 'NewBitcoinTransfer').withArgs(
                await fastBtcBridge.getTransferId('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', 1), // bytes32 transferId,
                'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', // string btcAddress,
                BigNumber.from(1), // uint nonce,
                amountSatoshi, // uint amountSatoshi,
                feeSatoshi, // uint feeSatoshi,
                anotherAddress, // address rskAddress
            );
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
                ).to.emit(fastBtcBridgeFromFederator, 'BitcoinTransferStatusUpdated').withArgs(
                    transferId,
                    TRANSFER_STATUS_SENT
                );

                transfer = await fastBtcBridgeFromFederator.getTransfer(transferBtcAddress, transferNonce);
                expect(transfer.status).to.equal(TRANSFER_STATUS_SENT);

                // test idempodency
                await expect(
                    fastBtcBridgeFromFederator.markTransfersAsSent([transferId], signatures)
                ).to.not.emit(fastBtcBridgeFromFederator, 'BitcoinTransferStatusUpdated');
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

            it('emits events', async () => {
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

        describe('#reclaimTransfer', () => {
            const requiredBlocks = 10;
            let transfer: any;
            let reclaimableBlock: number;

            beforeEach(async () => {
                transfer = await fastBtcBridge.getTransferByTransferId(transferId);
                await fastBtcBridge.setRequiredBlocksBeforeReclaim(requiredBlocks)
                reclaimableBlock = transfer.blockNumber + requiredBlocks;
            });

            it("doesn't reclaim transfers when not enough blocks have passed", async () => {
                await expect(
                    fastBtcBridge.connect(anotherAccount).reclaimTransfer(transferId)
                ).to.be.revertedWith("Not enough blocks passed before reclaim");
                // next block will be the block we mine to +1, so we mine to -2
                await mineToBlock(reclaimableBlock - 2);
                await expect(
                    fastBtcBridge.connect(anotherAccount).reclaimTransfer(transferId)
                ).to.be.revertedWith("Not enough blocks passed before reclaim");
            });

            it('reclaims transfer when enough block have passed', async () => {
                expect(transfer.status).to.equal(TRANSFER_STATUS_NEW);
                await mineToBlock(reclaimableBlock - 1);
                await expect(
                    await fastBtcBridge.connect(anotherAccount).reclaimTransfer(transferId)
                ).to.changeEtherBalances(
                    [anotherAccount, fastBtcBridge],
                    [transferAmount, transferAmount.mul(-1)]
                );
                transfer = await fastBtcBridge.getTransferByTransferId(transferId);
                expect(transfer.status).to.equal(TRANSFER_STATUS_RECLAIMED);

                // cannot reclaim again
                await expect(
                    fastBtcBridge.connect(anotherAccount).reclaimTransfer(transferId)
                ).to.be.reverted;
            });

            it('emits events', async () => {
                await mineToBlock(reclaimableBlock);
                await expect(
                    fastBtcBridge.connect(anotherAccount).reclaimTransfer(transferId)
                ).to.emit(fastBtcBridgeFromFederator, 'BitcoinTransferStatusUpdated').withArgs(
                    transferId,
                    TRANSFER_STATUS_RECLAIMED
                );
            });

            it('only allows reclaiming own transfers', async () => {
                await mineToBlock(reclaimableBlock);
                await expect(
                    fastBtcBridge.reclaimTransfer(transferId)
                ).to.be.revertedWith("Can only reclaim own transfers");
            });
        });
    });

    describe('#getTransferId', () => {
        it('computes as expected', async () => {
            for (const btcAddress of ['bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', '1foo', 'bar']) {
                for (const nonce of [0, 1, 254]) {
                    const transferId = await fastBtcBridge.getTransferId(btcAddress, nonce);
                    const computed = ethers.utils.solidityKeccak256(
                        ['string', 'string', 'string', 'uint256'],
                        ['transfer:', btcAddress, ':', nonce]
                    );
                    expect(transferId).to.equal(computed);
                }
            }
        })
    });

    describe("#addFeeStructure", () => {
        it("requires owner", async () => {
            await expect(
                fastBtcBridge.connect(federators[0]).addFeeStructure(1, 5000, 10)
            ).to.be.reverted;

            await expect(
                fastBtcBridge.connect(ownerAccount).addFeeStructure(1, 5000, 10)
            ).to.not.be.reverted;
        });

        it("fails for existing index", async () => {
            await expect(
                fastBtcBridge.connect(ownerAccount).addFeeStructure(0, 5000, 10)
            ).to.be.reverted;
        });

        it("fails for invalid index", async () => {
            await expect(
                fastBtcBridge.connect(ownerAccount).addFeeStructure(255, 5000, 10)
            ).to.not.be.reverted;

            await expect(
                fastBtcBridge.connect(ownerAccount).addFeeStructure(256, 5000, 10)
            ).to.be.reverted;
        });
    });

    describe("#setCurrentFeeStructure", () => {
        it("requires owner", async () => {
            await expect(
                fastBtcBridge.connect(federators[0]).setCurrentFeeStructure(0)
            ).to.be.reverted;

            await expect(
                fastBtcBridge.connect(ownerAccount).setCurrentFeeStructure(0)
            ).to.not.be.reverted;
        });

        it("fails for nonexistent index", async () => {
            await expect(
                fastBtcBridge.connect(ownerAccount).setCurrentFeeStructure(1)
            ).to.be.reverted;
        });

        it("emits the event and sets variables and changes actual fees", async () => {
            await expect(
                fastBtcBridge.connect(ownerAccount).addFeeStructure(1, 1000, 10)
            ).to.not.be.reverted;

            await expect(
                fastBtcBridge.connect(ownerAccount).addFeeStructure(2, 2000, 20)
            ).to.not.be.reverted;

            let result = fastBtcBridge.connect(ownerAccount).setCurrentFeeStructure(1);
            await expect(result).to.not.be.reverted;
            await expect(result).to.emit(
                fastBtcBridge, 'BitcoinTransferFeeChanged'
            ).withArgs(1000, 10);

            await expect(await fastBtcBridge.currentFeeStructureIndex()).to.equal(1);
            await expect(await fastBtcBridge.baseFeeSatoshi()).to.equal(1000);
            await expect(await fastBtcBridge.dynamicFee()).to.equal(10);

            await expect(
                await fastBtcBridge.connect(anotherAccount).calculateCurrentFeeSatoshi(100000)
            ).to.equal(1100);


            result = fastBtcBridge.connect(ownerAccount).setCurrentFeeStructure(2);
            await expect(result).to.not.be.reverted;
            await expect(result).to.emit(
                fastBtcBridge, 'BitcoinTransferFeeChanged'
            ).withArgs(2000, 20);

            await expect(await fastBtcBridge.currentFeeStructureIndex()).to.equal(2);
            await expect(await fastBtcBridge.baseFeeSatoshi()).to.equal(2000);
            await expect(await fastBtcBridge.dynamicFee()).to.equal(20);

            await expect(
                await fastBtcBridge.connect(anotherAccount).calculateCurrentFeeSatoshi(100000)
            ).to.equal(2200);
        });
    });
});
