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
        NOT_APPLICABLE,
        NEW,
        SENDING,
        MINED,
        REFUNDED,
        RECLAIMED
    }

    struct BitcoinTransfer {
        address rskAddress;
        BitcoinTransferStatus status;
        uint8 nonce;
        uint8 feeStructureIndex;
        uint32 blockNumber;
        uint40 totalAmountSatoshi;
        string btcAddress;
    }

    struct TransferFee {
        // enough for up to 42 bitcoins :P
        uint32 baseFeeSatoshi;

        // 1 = 0.01 %
        uint16 dynamicFee;
    }

    event NewBitcoinTransfer(
        bytes32 indexed transferId,
        string  btcAddress,
        uint256 nonce,
        uint256 amountSatoshi,
        uint256 feeSatoshi,
        address indexed rskAddress
    );

    event BitcoinTransferBatchSending(
        bytes32 bitcoinTxHash,
        uint8   transferBatchSize
    );

    event BitcoinTransferFeeChanged(
        uint256 baseFeeSatoshi,
        uint256 dynamicFee
    );

    event BitcoinTransferStatusUpdated(
        bytes32               indexed transferId,
        BitcoinTransferStatus newStatus
    );

    uint256 public constant SATOSHI_DIVISOR = 1 ether / 100_000_000;

    // it is an uint32
    uint256 public constant MAX_BASE_FEE_SATOSHI = (1 << 32) - 1;

    // uint16; 0.01 % granularity
    uint256 public constant DYNAMIC_FEE_DIVISOR = 10_000;

    uint256 public constant MAXIMUM_VALID_NONCE = 254;
    // uint256 public constant MAX_REQUIRED_BLOCKS_BEFORE_RECLAIM = 7 * 24 * 60 * 60 / 30; // TODO: adjust this as needed

    mapping(bytes32 => BitcoinTransfer) public transfers;
    mapping(string => uint8) public nextNonces;

    IBTCAddressValidator public btcAddressValidator;

    // array of 256 fee structures
    TransferFee[256] public feeStructures;

    uint40 public minTransferSatoshi = 1000;
    uint40 public maxTransferSatoshi = 200_000_000; // 2 BTC


    // set in constructor
    uint8  public currentFeeStructureIndex;
    uint16 public dynamicFee;
    uint32 public baseFeeSatoshi;

//    uint32 public requiredBlocksBeforeReclaim = 72 * 60 * 60 / 30;

    constructor(
        FastBTCAccessControl accessControl,
        IBTCAddressValidator newBtcAddressValidator
    )
    FastBTCAccessControllable(accessControl)
    {
        btcAddressValidator = newBtcAddressValidator;

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

        uint256 nonce = getNextNonce(btcAddress);

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
//        // TODO: decide if it should be possible to also reclaim sent transfers
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
        // TODO: prevents dynamic-fee only
        require(feeStructures[feeStructureIndex].baseFeeSatoshi == 0, "This slot has already been used");
        // TODO: prevents dynamic-fee only
        require(newBaseFeeSatoshi > 0, "Base fee must be non-zero");
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
        // TODO: this prevents just setting the dynamic fee
        require(feeStructures[feeStructureIndex].baseFeeSatoshi > 0, "Fee structure entry unset");

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
