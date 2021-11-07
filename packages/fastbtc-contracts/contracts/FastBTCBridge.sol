//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";

import "./interfaces/IBTCAddressValidator.sol";
import "./FastBTCAccessControl.sol";
import "./FastBTCAccessControllable.sol";

contract FastBTCBridge is ReentrancyGuard, FastBTCAccessControllable {
    using SafeERC20 for IERC20;
    using Address for address payable;

    enum BitcoinTransferStatus {
        NOT_APPLICABLE, // the transfer slot has not been initialized
        NEW,            // the transfer was initiated
        SENDING,        // the federators have approved this transfer
                        // as part of a transfer batch
        MINED,          // the transfer was confirmedly mined in Bitcoin blockchain
        REFUNDED        // the transfer was refunded
        //, RECLAIMED       // the transfer was reclaimed by the user; not in use in this version of the contract
    }

    struct BitcoinTransfer {
        address rskAddress;            // source rskAddress
        BitcoinTransferStatus status;  // the current status
        uint8 nonce;                   // each Bitcoin address can be reused up to 255 times
        uint8 feeStructureIndex;       // the fee calculation to be applied to this transfer
        uint32 blockNumber;            // the RSK block number where this was initialized
        uint40 totalAmountSatoshi;     // the number of BTC satoshis that the user sent
        string btcAddress;             // the BTC address in legacy or Bech32 encoded format
    }

    struct TransferFee {
        // enough for up to 42 bitcoins :P The base fee that is to be paid for each transfer
        uint32 baseFeeSatoshi;

        // 1 = 0.01 %, i.e. 0.0000 - 1.0000 4 decimal fixed point proportional fee
        uint16 dynamicFee;
    }

    // emitted for a new user-initiated transfer. The amountSatoshi + feeSatoshi
    // correspond to the totalAmountSatoshi from the transfer
    event NewBitcoinTransfer(
        bytes32 indexed transferId,
        string  btcAddress,
        uint256 nonce,
        uint256 amountSatoshi,
        uint256 feeSatoshi,
        address indexed rskAddress
    );

    // Emitted when the federators have committed to sending a transfer batch. Each batch is limited to 40
    // transfers so uint8 should be more than sufficient. The bitcoinTxHash shall contain the resulting
    // transaction hash of the bitcoin transaction
    event BitcoinTransferBatchSending(
        bytes32 bitcoinTxHash,
        uint8   transferBatchSize
    );

    // Emitted whenever the status of an individual transfer is changed. Especially within a transaction
    // that has the BitcoinTransferBatchSending event, the next transferBatchSize BitcoinTransferStatusUpdated
    // events shall be the transfers sent in the BTC transaction with bitcoinTxHash as its transaction id
    event BitcoinTransferStatusUpdated(
        bytes32               indexed transferId,
        BitcoinTransferStatus newStatus
    );

    // Emitted when the fee structure is changed, to show the new prices
    event BitcoinTransferFeeChanged(
        uint256 baseFeeSatoshi,
        uint256 dynamicFee
    );

    // Divisor for converting
    uint256 public constant SATOSHI_DIVISOR = 1 ether / 100_000_000;

    // The fee must fit in an uint32
    uint256 public constant MAX_BASE_FEE_SATOSHI = type(uint32).max;

    // uint16; 0.01 % granularity
    uint256 public constant DYNAMIC_FEE_DIVISOR = 10_000;

    // After the 255th transfer, with nonce 254, the nextNonces slot will be set to 255;
    // that is unusable because after that nextNonces would roll over
    uint8 public constant MAXIMUM_VALID_NONCE = 254;

    // uint256 public constant MAX_REQUIRED_BLOCKS_BEFORE_RECLAIM = 7 * 24 * 60 * 60 / 30; // TODO: adjust this as needed
    mapping(bytes32 => BitcoinTransfer) public transfers;

    // the next nonce to be used for each bitcoin address
    mapping(string => uint8) public nextNonces;

    // The BTC Address validator
    IBTCAddressValidator public btcAddressValidator;

    // array of 256 fee structures
    TransferFee[256] public feeStructures;

    uint40 public minTransferSatoshi = 1000;
    uint40 public maxTransferSatoshi = 200_000_000; // 2 BTC


    // set in the constructor / whenever the fee structure is changed
    uint8  public currentFeeStructureIndex;
    uint16 public dynamicFee;
    uint32 public baseFeeSatoshi;

    constructor(
        FastBTCAccessControl accessControl,
        IBTCAddressValidator newBtcAddressValidator
    )
    FastBTCAccessControllable(accessControl)
    {
        btcAddressValidator = newBtcAddressValidator;

        // we have a default fee here
        _addFeeStructure({
            feeStructureIndex: 0,
            newBaseFeeSatoshi: 500,
            newDynamicFee: 1 // 0.01 %
        });

        _setCurrentFeeStructure(0);
    }

    // PUBLIC USER API
    // ===============

    function transferToBtc(
        string calldata btcAddress
    )
    external
    payable
    {
        require(isValidBtcAddress(btcAddress), "Invalid BTC address");

        uint8 nonce = nextNonces[btcAddress];

        // strictly less than 255!
        require(nonce <= MAXIMUM_VALID_NONCE, "Maximum number of transfers to address reached");

        require(msg.value % SATOSHI_DIVISOR == 0, "RBTC amount must be evenly divisible to Satoshis");

        uint256 amountSatoshi = msg.value / SATOSHI_DIVISOR;
        require(amountSatoshi >= minTransferSatoshi, "RBTC BitcoinTransfer smaller than minimum");
        require(amountSatoshi <= maxTransferSatoshi, "RBTC BitcoinTransfer greater than maximum");

        uint256 feeSatoshi = calculateCurrentFeeSatoshi(amountSatoshi);

        bytes32 transferId = getTransferId(btcAddress, nonce);

        require(transfers[transferId].status == BitcoinTransferStatus.NOT_APPLICABLE, "Transfer already exists");
        // shouldn't happen ever

        transfers[transferId] = BitcoinTransfer({
            rskAddress: msg.sender,
            status: BitcoinTransferStatus.NEW,
            nonce: uint8(nonce), // within limits!
            feeStructureIndex: currentFeeStructureIndex,
            blockNumber: uint32(block.number), // ! 70 years with 1 second block time...
            totalAmountSatoshi: uint40(amountSatoshi), // guarded, this is the total amount stored!
            btcAddress: btcAddress
        });

        nextNonces[btcAddress]++;

        // solidity 0.8.0 ensures that revert occurs if feeSatoshi > amountSatoshi
        // here we shall emit only the amount deducted with fee
        amountSatoshi -= feeSatoshi;

        emit NewBitcoinTransfer({
            transferId: transferId,
            btcAddress: btcAddress,
            nonce: nonce,
            amountSatoshi: amountSatoshi,
            feeSatoshi: feeSatoshi,
            rskAddress: msg.sender
        });
    }

// Reclamations are not yet supported!
//
//    function reclaimTransfer(
//        bytes32 transferId
//    )
//    external
//    nonReentrant
//    {
//        BitcoinTransfer storage transfer = transfers[transferId];
//        // decide if it should be possible to also reclaim sent transfers
//        require(
//            transfer.status == BitcoinTransferStatus.NEW,
//            "Invalid existing BitcoinTransfer status or BitcoinTransfer not found"
//        );
//        require(
//            transfer.rskAddress == msg.sender,
//            "Can only reclaim own transfers"
//        );
//        require(
//            block.number - transfer.blockNumber >= requiredBlocksBeforeReclaim,
//            "Not enough blocks passed before reclaim"
//        );
//
//        // ordering!
//        _updateTransferStatus(transferId, transfer, BitcoinTransferStatus.RECLAIMED);
//        _refundTransferRbtc(transfer);
//    }

    // FEDERATOR API
    // ==============

    function markTransfersAsSending(
        bytes32 bitcoinTxHash,
        bytes32[] calldata transferIds,
        bytes[] memory signatures
    )
    external
    onlyFederator
    {
        emit BitcoinTransferBatchSending(bitcoinTxHash, uint8(transferIds.length));

        accessControl.checkFederatorSignatures(
            getTransferBatchUpdateHashWithTxHash(bitcoinTxHash, transferIds, BitcoinTransferStatus.SENDING),
            signatures
        );

        for (uint256 i = 0; i < transferIds.length; i++) {
            BitcoinTransfer storage transfer = transfers[transferIds[i]];

            require(
                transfer.status == BitcoinTransferStatus.NEW,
                "Invalid existing BitcoinTransfer status or BitcoinTransfer not found"
            );

            _updateTransferStatus(transferIds[i], transfer, BitcoinTransferStatus.SENDING);
        }
    }

    function markTransfersAsMined(
        bytes32[] calldata transferIds,
        bytes[] memory signatures
    )
    external
    onlyFederator
    {
        accessControl.checkFederatorSignatures(
            getTransferBatchUpdateHash(transferIds, BitcoinTransferStatus.MINED),
            signatures
        );

        for (uint256 i = 0; i < transferIds.length; i++) {
            BitcoinTransfer storage transfer = transfers[transferIds[i]];

            require(
                transfer.status == BitcoinTransferStatus.SENDING,
                "Invalid existing BitcoinTransfer status or BitcoinTransfer not found"
            );

            _updateTransferStatus(transferIds[i], transfer, BitcoinTransferStatus.MINED);
        }
    }

    function refundTransfers(
        bytes32[] calldata transferIds,
        bytes[] memory signatures
    )
    external
    onlyFederator
    {
        accessControl.checkFederatorSignatures(
            getTransferBatchUpdateHash(transferIds, BitcoinTransferStatus.REFUNDED),
            signatures
        );

        for (uint256 i = 0; i < transferIds.length; i++) {
            BitcoinTransfer storage transfer = transfers[transferIds[i]];
            require(transfer.status == BitcoinTransferStatus.NEW, "Invalid existing transfer status or transfer not found");

            _updateTransferStatus(transferIds[i], transfer, BitcoinTransferStatus.REFUNDED);
            _refundTransferRbtc(transfer);
        }
    }

    // FEDERATOR UTILITY METHODS
    // =========================

    function getTransferBatchUpdateHash(
        bytes32[] calldata transferIds,
        BitcoinTransferStatus newStatus
    )
    public
    pure
    returns (bytes32)
    {
        return keccak256(abi.encodePacked("batchUpdate:", newStatus, ":", transferIds));
    }

    function getTransferBatchUpdateHashWithTxHash(
        bytes32 bitcoinTxHash,
        bytes32[] calldata transferIds,
        BitcoinTransferStatus newStatus
    )
    public
    pure
    returns (bytes32)
    {
        return keccak256(abi.encodePacked("batchUpdateWithTxHash:", newStatus, ":", bitcoinTxHash, ":", transferIds));
    }


    // FEDERATOR PRIVATE METHODS
    // =========================

    function _updateTransferStatus(
        bytes32 transferId,
        BitcoinTransfer storage transfer,
        BitcoinTransferStatus newStatus
    )
    private
    {
        transfer.status = newStatus;
        emit BitcoinTransferStatusUpdated(
            transferId,
            newStatus
        );
    }

    function _refundTransferRbtc(
        BitcoinTransfer storage transfer
    )
    private
    {
        uint256 refundWei = transfer.totalAmountSatoshi * SATOSHI_DIVISOR;
        payable(transfer.rskAddress).sendValue(refundWei);
    }

    // INTERNAL FEE STRUCTURE API
    // ==========================

    function _addFeeStructure(
        uint256 feeStructureIndex,
        uint256 newBaseFeeSatoshi,
        uint256 newDynamicFee
    )
    private
    {
        require(feeStructureIndex < feeStructures.length, "Too large fee structure index");
        require(feeStructures[feeStructureIndex].baseFeeSatoshi == 0
                && feeStructures[feeStructureIndex].dynamicFee == 0, "This slot has already been used");

        require(newBaseFeeSatoshi <= MAX_BASE_FEE_SATOSHI, "Base fee exceeds maximum");
        require(newDynamicFee < DYNAMIC_FEE_DIVISOR, "Dynamic fee divisor too high");

        // guarded
        feeStructures[feeStructureIndex].baseFeeSatoshi = uint32(newBaseFeeSatoshi);

        // guarded
        feeStructures[feeStructureIndex].dynamicFee = uint16(newDynamicFee);
    }

    function _setCurrentFeeStructure(
        uint256 feeStructureIndex
    )
    private
    {
        require(feeStructureIndex < feeStructures.length, "Fee structure index invalid");
        require(feeStructures[feeStructureIndex].baseFeeSatoshi > 0
            || feeStructures[feeStructureIndex].dynamicFee > 0,
            "Fee structure entry unset");

        // guarded
        currentFeeStructureIndex = uint8(feeStructureIndex);
        baseFeeSatoshi = feeStructures[feeStructureIndex].baseFeeSatoshi;
        dynamicFee = feeStructures[feeStructureIndex].dynamicFee;

        emit BitcoinTransferFeeChanged({
            baseFeeSatoshi: baseFeeSatoshi,
            dynamicFee: dynamicFee
        });
    }

    // PUBLIC UTILITY METHODS
    // ======================
    function getTransferId(
        string calldata btcAddress,
        uint256 nonce
    )
    public
    pure
    returns (bytes32)
    {
        return keccak256(abi.encodePacked("transfer:", btcAddress, ":", nonce));
    }

    function getNextNonce(
        string calldata btcAddress
    )
    public
    view
    returns (uint8)
    {
        return nextNonces[btcAddress];
    }

    function calculateCurrentFeeSatoshi(
        uint256 amountSatoshi
    )
    public
    view
    returns (uint256) {
        return baseFeeSatoshi + (amountSatoshi * dynamicFee / DYNAMIC_FEE_DIVISOR);
    }

    /// @dev pure utility function to be used in DApps
    function calculateCurrentFeeWei(
        uint256 amountWei
    )
    public
    view
    returns (uint256) {
        uint256 amountSatoshi = amountWei / SATOSHI_DIVISOR;
        return calculateCurrentFeeSatoshi(amountSatoshi) * SATOSHI_DIVISOR;
    }

    function getTransferByTransferId(
        bytes32 transferId
    )
    public
    view
    returns (BitcoinTransfer memory transfer) {
        transfer = transfers[transferId];
        require(transfer.status != BitcoinTransferStatus.NOT_APPLICABLE, "Transfer doesn't exist");
    }

    function getTransfer(
        string calldata btcAddress,
        uint8 nonce
    )
    public
    view
    returns (BitcoinTransfer memory transfer) {
        bytes32 transferId = getTransferId(btcAddress, nonce);
        transfer = getTransferByTransferId(transferId);
    }

    function getTransfersByTransferId(
        bytes32[] calldata transferIds
    )
    public
    view
    returns (BitcoinTransfer[] memory ret) {
        ret = new BitcoinTransfer[](transferIds.length);
        for (uint256 i = 0; i < transferIds.length; i++) {
            ret[i] = transfers[transferIds[i]];
            require(ret[i].status != BitcoinTransferStatus.NOT_APPLICABLE, "Transfer doesn't exist");
        }
    }

    function getTransfers(
        string[] calldata btcAddresses,
        uint8[] calldata nonces
    )
    public
    view
    returns (BitcoinTransfer[] memory ret) {
        require(btcAddresses.length == nonces.length, "same amount of btcAddresses and nonces must be given");
        ret = new BitcoinTransfer[](btcAddresses.length);
        for (uint256 i = 0; i < btcAddresses.length; i++) {
            ret[i] = transfers[getTransferId(btcAddresses[i], nonces[i])];
            require(ret[i].status != BitcoinTransferStatus.NOT_APPLICABLE, "Transfer doesn't exist");
        }
    }

    // TODO: maybe get rid of this -- it's needlessly duplicated to preserve backwards compatibility
    function isValidBtcAddress(
        string calldata btcAddress
    )
    public
    view
    returns (bool)
    {
        return btcAddressValidator.isValidBtcAddress(btcAddress);
    }

    // TODO: maybe get rid of this -- it's needlessly duplicated to preserve backwards compatibility
    function federators()
    public
    view
    returns (address[] memory addresses)
    {
        addresses = accessControl.federators();
    }

    // ADMIN API
    // =========

    function setBtcAddressValidator(
        IBTCAddressValidator newBtcAddressValidator
    )
    external
    onlyAdmin
    {
        btcAddressValidator = newBtcAddressValidator;
    }

    function addFeeStructure(
        uint256 feeStructureIndex,
        uint256 newBaseFeeSatoshi,
        uint256 newDynamicFee
    )
    external
    onlyAdmin
    {
        _addFeeStructure({
            feeStructureIndex: feeStructureIndex,
            newBaseFeeSatoshi: newBaseFeeSatoshi,
            newDynamicFee: newDynamicFee
        });
    }

    function setCurrentFeeStructure(
        uint256 feeStructureIndex
    )
    external
    onlyAdmin
    {
        _setCurrentFeeStructure(feeStructureIndex);
    }

    function setMinTransferSatoshi(
        uint256 newMinTransferSatoshi
    )
    external
    onlyAdmin
    {
        require(newMinTransferSatoshi < (2 << 40), "Must fit in uint40");
        minTransferSatoshi = uint40(newMinTransferSatoshi);
    }

    function setMaxTransferSatoshi(
        uint256 newMaxTransferSatoshi
    )
    external
    onlyAdmin
    {
        require(newMaxTransferSatoshi < (2 << 40), "Must fit in uint40");
        maxTransferSatoshi = uint40(newMaxTransferSatoshi);
    }

//    function setRequiredBlocksBeforeReclaim(
//        uint256 newRequiredBlocksBeforeReclaim
//    )
//    external
//    onlyAdmin
//    {
//        require(
//            newRequiredBlocksBeforeReclaim <= MAX_REQUIRED_BLOCKS_BEFORE_RECLAIM,
//            "Required blocks before reclaim too large"
//        );
//        requiredBlocksBeforeReclaim = uint32(newRequiredBlocksBeforeReclaim);
//    }

    // TODO: figure out if we want to lock this so that only fees can be retrieved
    /// @dev utility for withdrawing RBTC from the contract
    function withdrawRbtc(
        uint256 amount,
        address payable receiver
    )
    external
    onlyAdmin
    {
        receiver.sendValue(amount);
    }

    /// @dev utility for withdrawing tokens accidentally sent to the contract
    function withdrawTokens(
        IERC20 token,
        uint256 amount,
        address receiver
    )
    external
    onlyAdmin
    {
        token.safeTransfer(receiver, amount);
    }
}
