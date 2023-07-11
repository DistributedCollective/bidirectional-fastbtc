import {expect} from 'chai';
import {beforeEach, describe, it} from 'mocha';
import {ethers} from 'hardhat';
import {BigNumber, Contract, Signer} from 'ethers';
import {parseEther, parseUnits} from 'ethers/lib/utils';


const TRANSFER_STATUS_NOT_APPLICABLE = 0;
const TRANSFER_STATUS_NEW = 1; // not 0 to make checks easier
const TRANSFER_STATUS_SENDING = 2;
const TRANSFER_STATUS_MINED = 3;
const TRANSFER_STATUS_REFUNDED = 4;
const TRANSFER_STATUS_RECLAIMED = 5;
const TRANSFER_STATUS_INVALID = 255

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

        await fastBtcBridge.markReady();

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
        let updateHash = await fastBtcBridge.getTransferBatchUpdateHash([], TRANSFER_STATUS_SENDING);
        let expected = ethers.utils.solidityKeccak256(
            ["string", "address", "string", "uint8", "string", "bytes32[]"],
            ["batchUpdate:", fastBtcBridge.address, ":", TRANSFER_STATUS_SENDING, ":", []],
        );
        expect(updateHash).to.equal(expected);

        updateHash = await fastBtcBridge.getTransferBatchUpdateHash([], TRANSFER_STATUS_MINED);
        expected = ethers.utils.solidityKeccak256(
            ["string", "address", "string", "uint8", "string", "bytes32[]"],
            ["batchUpdate:", fastBtcBridge.address, ":", TRANSFER_STATUS_MINED, ":", []],
        );
        expect(updateHash).to.equal(expected);

        updateHash = await fastBtcBridge.getTransferBatchUpdateHash([], TRANSFER_STATUS_REFUNDED);
        expected = ethers.utils.solidityKeccak256(
            ["string", "address", "string", "uint8", "string", "bytes32[]"],
            ["batchUpdate:", fastBtcBridge.address, ":", TRANSFER_STATUS_REFUNDED, ":", []],
        );
        expect(updateHash).to.equal(expected);

        const btcTxHash = '0x6162636465666768696a6b6c6d6e6f707172737475767778797a414243444546';
        updateHash = await fastBtcBridge.getTransferBatchUpdateHashWithTxHash(btcTxHash, [], TRANSFER_STATUS_SENDING);
        expected = ethers.utils.solidityKeccak256(
            ["string", "address", "string", "uint8", "string", "bytes32", "string", "bytes32[]"],
            ["batchUpdateWithTxHash:", fastBtcBridge.address, ":", TRANSFER_STATUS_SENDING, ":", btcTxHash, ":", []],
        );
        expect(updateHash).to.equal(expected);
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

        describe('#markTransfersAsSending', () => {
            let updateHashBytes: Uint8Array;
            let btcTxHash: string = '0x6162636465666768696a6b6c6d6e6f707172737475767778797a414243444546';

            beforeEach(async () => {
                const updateHash = await fastBtcBridge.getTransferBatchUpdateHashWithTxHash(
                    btcTxHash,
                    [transferId],
                    TRANSFER_STATUS_SENDING
                );
                updateHashBytes = ethers.utils.arrayify(updateHash);
            });

            it('does not mark transfers as sent without signatures', async () => {
                await expect(
                    fastBtcBridgeFromFederator.markTransfersAsSending(
                        updateHashBytes,
                        [transferId],
                        []
                    )
                ).to.be.reverted;
            });

            it('marks transfers as sent if signed by enough federators', async () => {
                let transfer = await fastBtcBridgeFromFederator.getTransfer(transferBtcAddress, transferNonce);
                expect(transfer.status).to.equal(TRANSFER_STATUS_NEW);

                const signatures = [
                    await federators[0].signMessage(updateHashBytes),
                    await federators[1].signMessage(updateHashBytes),
                ];

               const execution = fastBtcBridgeFromFederator.markTransfersAsSending(
                    btcTxHash,
                    [transferId],
                    signatures
                )

                await expect(execution)
                    .to.emit(fastBtcBridgeFromFederator, 'BitcoinTransferBatchSending')
                    .withArgs(btcTxHash, 1)

                await expect(execution)
                    .to.emit(fastBtcBridgeFromFederator, 'BitcoinTransferStatusUpdated')
                    .withArgs(transferId, TRANSFER_STATUS_SENDING);

                transfer = await fastBtcBridgeFromFederator.getTransfer(transferBtcAddress, transferNonce);
                expect(transfer.status).to.equal(TRANSFER_STATUS_SENDING);

                // test that it's no longer idempotent
                await expect(
                    fastBtcBridgeFromFederator.markTransfersAsSending(
                        btcTxHash,
                        [transferId],
                        signatures
                    )
                ).to.be.reverted;
            });

            it('does not mark transfers as sent if signed by too few federators', async () => {
                const signatures = [
                    await federators[0].signMessage(updateHashBytes),
                ];

                await expect(
                    fastBtcBridgeFromFederator.markTransfersAsSending(
                        btcTxHash,
                        [transferId],
                        signatures
                    )
                ).to.be.reverted;
            });

            it('does not mark transfers as sent if signed by non-federators', async () => {
                const signatures = [
                    await federators[0].signMessage(updateHashBytes),
                    await anotherAccount.signMessage(updateHashBytes),
                ];

                await expect(
                    fastBtcBridgeFromFederator.markTransfersAsSending(
                        btcTxHash,
                        [transferId],
                        signatures
                    )
                ).to.be.reverted;
            });

            it('does not mark transfers as sent if wrong hash signed', async () => {
                const signatures = [
                    await federators[0].signMessage(ethers.utils.arrayify(
                        await fastBtcBridgeFromFederator.getTransferBatchUpdateHashWithTxHash(
                            btcTxHash, [transferId], TRANSFER_STATUS_NEW
                        ),
                    )),
                    await federators[1].signMessage(ethers.utils.arrayify(
                        await fastBtcBridgeFromFederator.getTransferBatchUpdateHashWithTxHash(
                            btcTxHash, [transferId], TRANSFER_STATUS_NEW
                        ),
                    )),
                ];

                await expect(
                    fastBtcBridgeFromFederator.markTransfersAsSending([transferId], signatures)
                ).to.be.reverted;
            });

            it('checks the tx hash inside the update hash', async () => {
                const signatures = [
                    await federators[0].signMessage(ethers.utils.arrayify(
                        await fastBtcBridgeFromFederator.getTransferBatchUpdateHashWithTxHash(
                            btcTxHash.replace(/6/, '7'), [transferId], TRANSFER_STATUS_SENDING
                        ),
                    )),
                    await federators[1].signMessage(ethers.utils.arrayify(
                        await fastBtcBridgeFromFederator.getTransferBatchUpdateHashWithTxHash(
                            btcTxHash.replace(/6/, '7'), [transferId], TRANSFER_STATUS_SENDING
                        ),
                    )),
                ];

                await expect(
                    fastBtcBridgeFromFederator.markTransfersAsSending(btcTxHash, [transferId], signatures)
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
                const btcTxHash = '0x6162636465666768696a6b6c6d6e6f707172737475767778797a414243444546';
                const sentHash = await fastBtcBridge.getTransferBatchUpdateHashWithTxHash(
                    btcTxHash,
                    [transferId],
                    TRANSFER_STATUS_SENDING
                );
                const sentHashBytes = ethers.utils.arrayify(sentHash);
                const sentSignatures = [
                    await federators[0].signMessage(sentHashBytes),
                    await federators[1].signMessage(sentHashBytes),
                ];
                await fastBtcBridgeFromFederator.markTransfersAsSending(
                    btcTxHash,
                    [transferId],
                    sentSignatures
                )
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

            it('does not reclaim when frozen', async () => {
                await fastBtcBridge.connect(ownerAccount).freeze();
                await mineToBlock(reclaimableBlock);
                await expect(
                    fastBtcBridge.reclaimTransfer(transferId)
                ).to.be.revertedWith("Freezable: frozen");
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

    describe('bridge integration', () => {
        beforeEach(async () => {
            await ownerAccount.sendTransaction({
                value: parseUnits('1', 'ether'),
                to: anotherAddress,
            });
            fastBtcBridge = fastBtcBridge.connect(anotherAccount);
        });

        it('encodes userData from token bridge', async () => {
            const ret = await fastBtcBridge.encodeBridgeUserData(
                '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
                'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
            );

            expect(ret).to.equal(
                '0x00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c' +
                '80000000000000000000000000000000000000000000000000000000000000040' +
                '000000000000000000000000000000000000000000000000000000000000002a6' +
                '263317177353038643671656a7874646734793572337a61727661727930633578' +
                '77376b76386633743400000000000000000000000000000000000000000000'
            );
        });

        it('decodes userData from tokenBridge', async () => {
            const [rskAddress, btcAddress] = await fastBtcBridge.decodeBridgeUserData(
                '0x00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c' +
                '80000000000000000000000000000000000000000000000000000000000000040' +
                '000000000000000000000000000000000000000000000000000000000000002a6' +
                '263317177353038643671656a7874646734793572337a61727661727930633578' +
                '77376b76386633743400000000000000000000000000000000000000000000'
            );

            expect(rskAddress).to.equal('0x70997970C51812dc3A010C7d01b50e0d17dc79C8');
            expect(btcAddress).to.equal('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
        });

        it('receiveEthFromBridge transfers rbtc', async () => {
            const amountEther = parseEther('0.8');

            const userData = await fastBtcBridge.encodeBridgeUserData(
                '0x0000000000000000000000000000000000001337',
                'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
            );

            await expect(
                await fastBtcBridge.receiveEthFromBridge(
                    userData,
                    {
                        value: amountEther,
                    }
                )
            ).to.changeEtherBalances(
                [anotherAccount, fastBtcBridge],
                [amountEther.mul(-1), amountEther]
            );
        });

        it('receiveEthFromBridge emits the correct event', async () => {
            const amountEther = parseEther('0.5');
            let amountSatoshi = BigNumber.from(Math.floor(0.5 * 10 ** 8))
            const feeSatoshi = await fastBtcBridge.calculateCurrentFeeSatoshi(amountSatoshi);
            amountSatoshi = amountSatoshi.sub(feeSatoshi);

            const userData = await fastBtcBridge.encodeBridgeUserData(
                '0x0000000000000000000000000000000000001337',
                'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
            );

            await expect(
                fastBtcBridge.receiveEthFromBridge(
                    userData,
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
                '0x0000000000000000000000000000000000001337', // address _rskAddress
            );
        });
    });

    describe('#withdrawTokens', () => {
        const amount1 = parseEther('0.1');
        const amount2 = parseEther('0.05');
        const transferBtcAddress = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
        let transferId1: string;
        let transferId2: string;
        let transfer1: any;
        let transfer2: any;

        const markTransfersAsSending = async (transferIds: string[]) => {
            // Fake tx hash
            const btcTxHash = '0x6162636465666768696a6b6c6d6e6f707172737475767778797a414243444546';
            const updateHash = await fastBtcBridge.getTransferBatchUpdateHashWithTxHash(
                btcTxHash,
                transferIds,
                TRANSFER_STATUS_SENDING
            );
            const updateHashBytes = ethers.utils.arrayify(updateHash);
            const signatures = [
                await federators[0].signMessage(updateHashBytes),
                await federators[1].signMessage(updateHashBytes),
            ];
            await fastBtcBridgeFromFederator.markTransfersAsSending(
                btcTxHash,
                transferIds,
                signatures
            );
        }

        beforeEach(async () => {
            transferId1 = await createExampleTransfer(
                anotherAccount,
                amount1,
                transferBtcAddress,
            );
            transfer1 = await fastBtcBridge.getTransferByTransferId(transferId1);
            transferId2 = await createExampleTransfer(
                anotherAccount,
                amount2,
                transferBtcAddress,
            );
            transfer2 = await fastBtcBridge.getTransferByTransferId(transferId2);
        });

        it('cannot withdraw unsent rBTC', async () => {
            await expect(
                fastBtcBridge.withdrawRbtc(amount1, ownerAddress)
            ).to.be.reverted;
        });

        it('can withdraw up to sent rBTC', async () => {
            await markTransfersAsSending([transferId1]);

            await expect(
                fastBtcBridge.withdrawRbtc(amount1.add(1), ownerAddress)
            ).to.be.reverted;

            await expect(
                await fastBtcBridge.withdrawRbtc(amount1, ownerAddress)
            ).to.changeEtherBalance(ownerAccount, amount1);

            await expect(
                fastBtcBridge.withdrawRbtc(1, ownerAddress)
            ).to.be.reverted;

            await markTransfersAsSending([transferId2]);
            await expect(
                await fastBtcBridge.withdrawRbtc(amount2, ownerAddress)
            ).to.changeEtherBalance(ownerAccount, amount2);

            await expect(
                fastBtcBridge.withdrawRbtc(1, ownerAddress)
            ).to.be.reverted;
        });

        it('can withdraw up to sent rBTC 2', async () => {
            await markTransfersAsSending([transferId1]);

            await expect(
                await fastBtcBridge.withdrawRbtc(amount1.div(2), ownerAddress)
            ).to.changeEtherBalance(ownerAccount, amount1.div(2));

            await expect(
                fastBtcBridge.withdrawRbtc(amount1.div(2).add(1), ownerAddress)
            ).to.be.reverted;

            await markTransfersAsSending([transferId2]);

            await expect(
                await fastBtcBridge.withdrawRbtc(amount1.div(2).add(1), ownerAddress)
            ).to.changeEtherBalance(ownerAccount, amount1.div(2).add(1));

            await expect(
                fastBtcBridge.withdrawRbtc(amount2, ownerAddress)
            ).to.be.reverted;

            await expect(
                await fastBtcBridge.withdrawRbtc(amount2.sub(1), ownerAddress)
            ).to.changeEtherBalance(ownerAccount, amount2.sub(1));

            await expect(
                fastBtcBridge.withdrawRbtc(1, ownerAddress)
            ).to.be.reverted;
        });

        it('cannot withdraw reclaimed transfers', async () => {
            await fastBtcBridge.setRequiredBlocksBeforeReclaim(0)
            await markTransfersAsSending([transferId1]);
            await fastBtcBridge.connect(anotherAccount).reclaimTransfer(transferId2);

            await expect(
                fastBtcBridge.withdrawRbtc(amount1.add(1), ownerAddress)
            ).to.be.reverted;

            await expect(
                await fastBtcBridge.withdrawRbtc(amount1, ownerAddress)
            ).to.changeEtherBalance(ownerAccount, amount1);

            await expect(
                fastBtcBridge.withdrawRbtc(1, ownerAddress)
            ).to.be.reverted;
        });
    });

    describe('#setNodeConfigValue', () => {
        const key1 = '0x1234567812345678123456781234567812345678123456781234567812345678';
        const key2 = '0x8765432112345678123456781234567812345678123456781234567812345678';
        const value1 = '0x1234';
        const value2 = '0x4321';

        it('is not allowed for arbitrary account', async () => {
            await expect(
                fastBtcBridge.connect(anotherAccount).setNodeConfigValue(key1, value1)
            ).to.be.reverted;
        });

        it('is allowed for owner', async () => {
            await fastBtcBridge.setNodeConfigValue(key1, value1);
        });

        it('sets keys separately', async () => {
            await fastBtcBridge.setNodeConfigValue(key1, value1);
            await fastBtcBridge.setNodeConfigValue(key2, value2);
            expect(await fastBtcBridge.nodeConfig(key1)).to.equal(value1);
            expect(await fastBtcBridge.nodeConfig(key2)).to.equal(value2);
            await fastBtcBridge.setNodeConfigValue(key2, value1);
            expect(await fastBtcBridge.nodeConfig(key2)).to.equal(value1);
        });

        it('is allowed for arbitrary account after grant and not after revoke', async () => {
            await accessControl.addConfigAdmin(anotherAccount.getAddress());
            await fastBtcBridge.connect(anotherAccount).setNodeConfigValue(key1, value1);
            await accessControl.removeConfigAdmin(anotherAccount.getAddress());
            await expect(fastBtcBridge.connect(anotherAccount).setNodeConfigValue(key1, value1)).to.be.reverted;
        });

        it('can be deleted only by authorized', async () => {
            await fastBtcBridge.setNodeConfigValue(key1, value1);
            await expect(fastBtcBridge.connect(anotherAccount).deleteNodeConfigValue(key1)).to.be.reverted;
            await accessControl.addConfigAdmin(anotherAccount.getAddress());
            await fastBtcBridge.connect(anotherAccount).deleteNodeConfigValue(key1);
            expect(await fastBtcBridge.nodeConfig(key1)).to.equal('0x');
        });
    });

    describe('Initialization', () => {
        let oldFastBtcBridge: Contract;
        let oldFastBtcBridgeFromFederator: Contract;
        const btcAddress1 = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
        const btcAddress2 = "1BvBMSEYstWetqTFn5Au4m4GFg";
        const btcAddress3 = "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2";

        beforeEach(async () => {
            oldFastBtcBridge = fastBtcBridge;
            oldFastBtcBridgeFromFederator = fastBtcBridgeFromFederator;

            const FastBTCBridge = await ethers.getContractFactory("FastBTCBridge");
            fastBtcBridge = await FastBTCBridge.deploy(
                accessControl.address,
                btcAddressValidator.address
            );
            await fastBtcBridge.deployed();

            // DO NOT initialize
            fastBtcBridgeFromFederator = fastBtcBridge.connect(federators[0]);
        });

        it('can be marked ready exactly once', async () => {
            await fastBtcBridge.markReady();
            await expect(fastBtcBridge.markReady()).to.be.revertedWith('Contract already initialized');
        });

        it('marking ready raises the Initialized event', async () => {
            await expect(fastBtcBridge.markReady()).to.emit(fastBtcBridge, 'Initialized');
        });

        it('nonces can be copied before initialization by the admin', async () => {
            const transferAmount = parseEther('0.01');
            await oldFastBtcBridge.connect(anotherAccount).transferToBtc(
                btcAddress1,
                {
                    value: transferAmount,
                }
            );
            await oldFastBtcBridge.connect(anotherAccount).transferToBtc(
                btcAddress2,
                {
                    value: transferAmount,
                }
            );
            await oldFastBtcBridge.connect(anotherAccount).transferToBtc(
                btcAddress1,
                {
                    value: transferAmount,
                }
            );

            expect(await fastBtcBridge.getNextNonce(btcAddress1)).to.equal(0);
            expect(await fastBtcBridge.getNextNonce(btcAddress2)).to.equal(0);
            expect(await fastBtcBridge.getNextNonce(btcAddress3)).to.equal(0);
            expect(await fastBtcBridge.previousFastBtcBridgeContract()).to.equal(ethers.constants.AddressZero);

            await fastBtcBridge.copyNonces(oldFastBtcBridge.address, [btcAddress1, btcAddress2, btcAddress3]);

            expect(await fastBtcBridge.getNextNonce(btcAddress1)).to.equal(2);
            expect(await fastBtcBridge.getNextNonce(btcAddress2)).to.equal(1);
            expect(await fastBtcBridge.getNextNonce(btcAddress3)).to.equal(0);
            // test that it sets the address
            expect(await fastBtcBridge.previousFastBtcBridgeContract()).to.equal(oldFastBtcBridge.address);

            await oldFastBtcBridge.connect(anotherAccount).transferToBtc(
                btcAddress2,
                {
                    value: transferAmount,
                }
            );

            // can be copied again
            await fastBtcBridge.copyNonces(oldFastBtcBridge.address, [btcAddress2]);
            expect(await fastBtcBridge.getNextNonce(btcAddress1)).to.equal(2);
            expect(await fastBtcBridge.getNextNonce(btcAddress2)).to.equal(2);
            expect(await fastBtcBridge.getNextNonce(btcAddress3)).to.equal(0);

            // only by admin
            await expect(fastBtcBridge.connect(anotherAccount).copyNonces(oldFastBtcBridge.address, [btcAddress2])).to.be.reverted;

            await fastBtcBridge.markReady();
            await expect(fastBtcBridge.copyNonces(oldFastBtcBridge.address, [btcAddress2])).to.be.reverted;
        });

        it('new transfers can only be made after initialization', async () => {
            const transferAmount = parseEther('0.01');
            await expect(
                fastBtcBridge.connect(anotherAccount).transferToBtc(
                    btcAddress1,
                    {
                        value: transferAmount,
                    }
                )
            ).to.be.revertedWith("Contract not initialized");
            const userData = await fastBtcBridge.encodeBridgeUserData(
                '0x0000000000000000000000000000000000001337',
                'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
            );

            await expect(
                fastBtcBridge.connect(anotherAccount).receiveEthFromBridge(
                    userData,
                    {
                        value: transferAmount,
                    }
                )
            ).to.be.revertedWith("Contract not initialized");

            await fastBtcBridge.markReady();

            await fastBtcBridge.connect(anotherAccount).transferToBtc(
                btcAddress1,
                {
                    value: transferAmount,
                }
            );
            await fastBtcBridge.connect(anotherAccount).receiveEthFromBridge(
                userData,
                {
                    value: transferAmount,
                }
            );
        });

        it('non-admin functions cannot be called when the contract is not initialized', async () => {
            const fauxBytes32 = '0x0000000000000000000000000000000000000000000000000000000000000000';
            const promises = [
                fastBtcBridge.connect(anotherAccount).reclaimTransfer(
                    fauxBytes32,
                ),
                fastBtcBridgeFromFederator.markTransfersAsSending(
                    fauxBytes32,
                    [fauxBytes32],
                    [fauxBytes32],
                ),
                fastBtcBridgeFromFederator.markTransfersAsMined(
                    [fauxBytes32],
                    [fauxBytes32],
                ),
                fastBtcBridgeFromFederator.refundTransfers(
                    [fauxBytes32],
                    [fauxBytes32],
                ),
            ]
            for (const promise of promises) {
                await expect(
                    promise,
                ).to.be.revertedWith("Contract not initialized");
            }

            // it's implicitly tested by other tests that they work when the contract is initialized
        });
    });

    describe('Obsolescence', () => {
        it('can be marked obsolete by the admin when frozen', async () => {
            expect(await fastBtcBridge.supersedingFastBtcBridgeContract()).to.equal(ethers.constants.AddressZero);
            expect(await fastBtcBridge.replacementReason()).to.equal("");

            await expect(fastBtcBridge.markObsolete(
                '0x0000000000000000000000000000000000001337',
                "I'm obsolete!"
            )).to.be.revertedWith('Freezable: not frozen');

            // freeze it
            await fastBtcBridge.freeze();

            // no non-admin
            await expect(fastBtcBridgeFromFederator.markObsolete(
                '0x0000000000000000000000000000000000001337',
                "I'm obsolete!"
            )).to.be.revertedWith(
                'AccessControl: account 0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc is missing role 0x0000000000000000000000000000000000000000000000000000000000000000'
            );

            await expect(fastBtcBridge.markObsolete(
                '0x0000000000000000000000000000000000001337',
                "I'm obsolete!"
            )).to.emit(fastBtcBridge, 'MarkedObsolete').withArgs(
                '0x0000000000000000000000000000000000001337',
                "I'm obsolete!"
            );
            expect(await fastBtcBridge.supersedingFastBtcBridgeContract()).to.equal('0x0000000000000000000000000000000000001337');
            expect(await fastBtcBridge.replacementReason()).to.equal("I'm obsolete!");
        });

    });
});
