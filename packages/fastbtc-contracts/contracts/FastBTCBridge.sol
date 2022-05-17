//SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "@openzeppelin/contracts/security/Pausable.sol";
import "./Freezable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";

import "./interfaces/IBTCAddressValidator.sol";
import "./FastBTCAccessControllable.sol";

/// @title The main FastBTC contract
/// @notice Accepts rBTC from users and provides methods for federators to track/update the state of transfers.
contract FastBTCBridge is ReentrancyGuard, FastBTCAccessControllable, Pausable, Freezable {
    using SafeERC20 for IERC20;
    using Address for address payable;

    /// @dev Status of an rBTC-to-BTC transfer.
    enum BitcoinTransferStatus {
        NOT_APPLICABLE, // the transfer slot has not been initialized
        NEW,            // the transfer was initiated
        SENDING,        // the federators have approved this transfer
                        // as part of a transfer batch
        MINED,          // the transfer was confirmedly mined in Bitcoin blockchain
        REFUNDED,       // the transfer was refunded
        RECLAIMED       // the transfer was reclaimed by the user
    }

    /// @dev An rBTC-to-BTC transfer.
    struct BitcoinTransfer {
        address rskAddress;            // source rskAddress
        BitcoinTransferStatus status;  // the current status
        uint8 nonce;                   // each Bitcoin address can be reused up to 255 times
        uint8 feeStructureIndex;       // the fee calculation to be applied to this transfer
        uint32 blockNumber;            // the RSK block number where this was initialized
        uint40 totalAmountSatoshi;     // the number of BTC satoshis that the user sent
        string btcAddress;             // the BTC address in legacy or Bech32 encoded format
    }

    /// @dev A structure to hold fee configurations -- storing index instead of the fields for each transfer
    /// saves storage space.
    struct TransferFee {
        // enough for up to 42 bitcoins :P The base fee that is to be paid for each transfer
        uint32 baseFeeSatoshi;

        // 1 = 0.01 %, i.e. 0.0000 - 1.0000 4 decimal fixed point proportional fee
        uint16 dynamicFee;
    }

    /// @dev Emitted for a new user-initiated transfer. The amountSatoshi + feeSatoshi correspond to the
    /// totalAmountSatoshi from the transfer.
    /// @param transferId       Unique identifier for this transfer.
    /// @param btcAddress       Bitcoin address the rBTC is transferred to.
    /// @param nonce            Incrementing nonce for transfers to the Bitcoin address.
    /// @param amountSatoshi    The amount (in satoshi) of BTC the user will receive (does not include fees)
    /// @param feeSatoshi       The amount (in satoshi) that is paid in fees.
    /// @param rskAddress       Address of the sender in RSK.
    event NewBitcoinTransfer(
        bytes32 indexed transferId,
        string  btcAddress,
        uint256 nonce,
        uint256 amountSatoshi,
        uint256 feeSatoshi,
        address indexed rskAddress
    );

    /// @dev Emitted when the federators have committed to sending a transfer batch. Each batch is limited to 40
    /// transfers so uint8 should be more than sufficient. The bitcoinTxHash shall contain the resulting
    /// transaction hash of the bitcoin transaction.
    /// @param bitcoinTxHash        Transaction hash/id of the Bitcoin transaction that transfers BTC in the batch.
    /// @param transferBatchSize    Number of transfers in this batch.
    event BitcoinTransferBatchSending(
        bytes32 bitcoinTxHash,
        uint8   transferBatchSize
    );

    /// @dev Emitted whenever the status of an individual transfer is changed. Especially within a transaction
    /// that has the BitcoinTransferBatchSending event, the next transferBatchSize BitcoinTransferStatusUpdated
    /// events shall be the transfers sent in the BTC transaction with bitcoinTxHash as its transaction id.
    /// @param transferId   Unique identifier for the transfer.
    /// @param newStatus    The updated status of the transfer.
    event BitcoinTransferStatusUpdated(
        bytes32               indexed transferId,
        BitcoinTransferStatus newStatus
    );

    /// @dev Emitted when the fee structure is changed, to show the new prices.
    /// @param baseFeeSatoshi   The constant fee (in satoshi) that will be paid for each transfer.
    /// @param dynamicFee       Numerator for the percentage fee that will be paid on top of the base fee.
    ///                         The denominator is DYNAMIC_FEE_SATOSHI.
    event BitcoinTransferFeeChanged(
        uint256 baseFeeSatoshi,
        uint256 dynamicFee
    );

    /// @dev Divisor for converting
    uint256 public constant SATOSHI_DIVISOR = 1 ether / 100_000_000;

    /// @dev The fee must fit in an uint32
    uint256 public constant MAX_BASE_FEE_SATOSHI = type(uint32).max;

    /// @dev Denominator for the dynamic fee. uint16; 0.01 % granularity
    uint256 public constant DYNAMIC_FEE_DIVISOR = 10_000;

    /// @dev After the 255th transfer, with nonce 254, the nextNonces slot will be set to 255;
    /// that is unusable because after that nextNonces would roll over
    uint8 public constant MAXIMUM_VALID_NONCE = 254;

    /// @dev Maximum possible number for required blocks before reclaiming
    uint256 public constant MAX_REQUIRED_BLOCKS_BEFORE_RECLAIM = 7 * 24 * 60 * 60 / 30;

    mapping(bytes32 => BitcoinTransfer) public transfers;

    /// @dev The next nonce to be used for each Bitcoin address
    mapping(string => uint8) public nextNonces;

    /// @dev The contract that validates Bitcoin addresses.
    IBTCAddressValidator public btcAddressValidator;

    /// @dev Array of 256 fee structures.
    TransferFee[256] public feeStructures;

    uint40 public minTransferSatoshi = 1000;
    uint40 public maxTransferSatoshi = 200_000_000; // 2 BTC

    /// @dev Set in the constructor and whenever the fee structure is changed.
    uint8  public currentFeeStructureIndex;
    uint16 public dynamicFee;
    uint32 public baseFeeSatoshi;

    uint32 public requiredBlocksBeforeReclaim = 72 * 60 * 60 / 30;


    /// @dev Constructor.
    /// @param accessControl            Address of the FastBTCAccessControl contract.
    /// @param newBtcAddressValidator   Address of the BTCAddressValidator contract.
    constructor(
        address accessControl,
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

    /// @dev The main function to transfer rBTC to BTC
    /// @dev Amount of Bitcoin is specified in msg.value, which must be evenly divisible by SATOSHI_DIVISOR
    /// @param btcAddress   The Bitcoin address to transfer the BTC to.
    function transferToBtc (
        string calldata btcAddress
    )
    external
    payable
    whenNotPaused
    {
        _transferToBtc(btcAddress, msg.sender, msg.value);
    }

    /// @dev Transfer rBTC to BTC from a given user address, with addresses encoded in userData.
    /// Integration to the token bridge -- called by the Bridge contract.
    /// Amount of Bitcoin is specified in msg.value, which must be evenly divisible by SATOSHI_DIVISOR.
    /// @param userData The originating user address (rskAddress) and the Bitcoin address to transfer the BTC to,
    ///                 encoded in bytes as in encodeBridgeUserData.
    function receiveEthFromBridge(
        bytes calldata userData
    )
    external
    payable
    whenNotPaused
    {
        (address rskAddress, string memory btcAddress) = decodeBridgeUserData(userData);
        _transferToBtc(btcAddress, rskAddress, msg.value);
    }

    function reclaimTransfer(
        bytes32 transferId
    )
    external
    nonReentrant
    whenNotFrozen
    {
        BitcoinTransfer storage transfer = transfers[transferId];
        // decide if it should be possible to also reclaim sent transfers
        require(
            transfer.status == BitcoinTransferStatus.NEW,
            "Invalid existing BitcoinTransfer status or BitcoinTransfer not found"
        );
        require(
            transfer.rskAddress == msg.sender,
            "Can only reclaim own transfers"
        );
        require(
            block.number - transfer.blockNumber >= requiredBlocksBeforeReclaim,
            "Not enough blocks passed before reclaim"
        );

        // ordering!
        _updateTransferStatus(transferId, transfer, BitcoinTransferStatus.RECLAIMED);
        _refundTransferRbtc(transfer);
    }

    // PRIVATE METHODS USED BY PUBLIC API
    // ==================================

    /// @dev Internal method to do the rBTC-to-BTC transfer, so it can be reused in multiple methods.
    function _transferToBtc (
        string memory btcAddress,
        address rskAddress,
        uint256 amountRbtc
    )
    private
    {
        require(isValidBtcAddress(btcAddress), "Invalid BTC address");

        uint8 nonce = nextNonces[btcAddress];

        // strictly less than 255!
        require(nonce <= MAXIMUM_VALID_NONCE, "Maximum number of transfers to address reached");

        require(amountRbtc % SATOSHI_DIVISOR == 0, "RBTC amount must be evenly divisible to Satoshis");

        uint256 amountSatoshi = amountRbtc / SATOSHI_DIVISOR;
        require(amountSatoshi >= minTransferSatoshi, "RBTC BitcoinTransfer smaller than minimum");
        require(amountSatoshi <= maxTransferSatoshi, "RBTC BitcoinTransfer greater than maximum");

        uint256 feeSatoshi = calculateCurrentFeeSatoshi(amountSatoshi);

        bytes32 transferId = getTransferId(btcAddress, nonce);

        require(transfers[transferId].status == BitcoinTransferStatus.NOT_APPLICABLE, "Transfer already exists");
        // shouldn't happen ever

        transfers[transferId] = BitcoinTransfer({
            rskAddress: rskAddress,
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
            rskAddress: rskAddress
        });
    }

    // FEDERATOR API
    // ==============

    /// @dev Federator method to indicate that the network has committed to sending a batch of Bitcoin transfers.
    /// Can only be called by federators.
    /// @param bitcoinTxHash    The pre-calculated Bitcoin transaction hash/id.
    /// @param transferIds      Identifiers of the transfers in the batch.
    /// @param signatures       Signatures from federators that have confirmed the batch update.
    ///                         The hash to sign is calculated using getTransferBatchUpdateHashWithTxHash.
    function markTransfersAsSending(
        bytes32 bitcoinTxHash,
        bytes32[] calldata transferIds,
        bytes[] memory signatures
    )
    external
    onlyFederator
    whenNotFrozen
    {
        emit BitcoinTransferBatchSending(bitcoinTxHash, uint8(transferIds.length));

        accessControl.checkFederatorSignatures(
            getTransferBatchUpdateHashWithTxHash(bitcoinTxHash, transferIds, BitcoinTransferStatus.SENDING),
            signatures
        );

        unchecked {
            for (uint256 i = 0; i < transferIds.length; i++) {
                BitcoinTransfer storage transfer = transfers[transferIds[i]];

                require(
                    transfer.status == BitcoinTransferStatus.NEW,
                    "Invalid existing BitcoinTransfer status or BitcoinTransfer not found"
                );

                _updateTransferStatus(transferIds[i], transfer, BitcoinTransferStatus.SENDING);
            }
        }
    }

    /// @dev Federator method to indicate that a batch of transfers has been successfully mined in Bitcoin.
    /// Can only be called by federators.
    /// @param transferIds      Identifiers of the transfers in the batch.
    /// @param signatures       Signatures from federators that have confirmed the batch update.
    ///                         The hash to sign is calculated using getTransferBatchUpdateHash.
    function markTransfersAsMined(
        bytes32[] calldata transferIds,
        bytes[] memory signatures
    )
    external
    onlyFederator
    whenNotFrozen
    {
        accessControl.checkFederatorSignatures(
            getTransferBatchUpdateHash(transferIds, BitcoinTransferStatus.MINED),
            signatures
        );

        unchecked {
            for (uint256 i = 0; i < transferIds.length; i++) {
                BitcoinTransfer storage transfer = transfers[transferIds[i]];

                require(
                    transfer.status == BitcoinTransferStatus.SENDING,
                    "Invalid existing BitcoinTransfer status or BitcoinTransfer not found"
                );

                _updateTransferStatus(transferIds[i], transfer, BitcoinTransferStatus.MINED);
            }
        }
    }

    /// @dev Federator method to send back rBTC, including fees, to the rskAddress(es) of one or more transfers.
    /// Can only be called by federators.
    /// @param transferIds      Identifiers of the transfers to refund
    /// @param signatures       Signatures from federators that have confirmed the refunding.
    ///                         The hash to sign is calculated using getTransferBatchUpdateHash.
    function refundTransfers(
        bytes32[] calldata transferIds,
        bytes[] memory signatures
    )
    external
    onlyFederator
    whenNotFrozen
    {
        accessControl.checkFederatorSignatures(
            getTransferBatchUpdateHash(transferIds, BitcoinTransferStatus.REFUNDED),
            signatures
        );

        unchecked {
            for (uint256 i = 0; i < transferIds.length; i++) {
                BitcoinTransfer storage transfer = transfers[transferIds[i]];
                require(transfer.status == BitcoinTransferStatus.NEW, "Invalid existing transfer status or transfer not found");

                _updateTransferStatus(transferIds[i], transfer, BitcoinTransferStatus.REFUNDED);
                _refundTransferRbtc(transfer);
            }
        }
    }

    // FEDERATOR UTILITY METHODS
    // =========================

    /// @dev Calculate the hash to sign for a batch update.
    /// @param transferIds  Identifiers of the transfers in the batch.
    /// @param newStatus    The status to update the state to.
    /// @return             The hash for the update, that can be signed by federators.
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

    /// @dev Calculate the hash to sign for a batch update for methods that require Bitcoin transaction hash.
    /// @param bitcoinTxHash    The transaction hash/id in the Bitcoin network.
    /// @param transferIds      Identifiers of the transfers in the batch.
    /// @param newStatus        The status to update the state to.
    /// @return                 The hash for the update, that can be signed by federators.
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

    /// @dev Internal method to update the status of a single transfer and emit the correct event.
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

    /// @dev Internal method to send back the rBTC associated with a transfer to the user.
    /// Does not update transfer status or emit events.
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

    /// @dev Internal method to add a new fee structure.
    /// Note that there's a limit on how many can be added and once added, fee structures cannot be removed.
    /// Also note that `newBaseFeeSatoshi` or `newDynamicFee` cannot both be 0
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
        require(newDynamicFee < DYNAMIC_FEE_DIVISOR, "Dynamic fee too high");

        // guarded
        feeStructures[feeStructureIndex].baseFeeSatoshi = uint32(newBaseFeeSatoshi);

        // guarded
        feeStructures[feeStructureIndex].dynamicFee = uint16(newDynamicFee);
    }

    /// @dev Internal method set the fee structure in use for new transfers
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

    /// @dev Calculate the unique id for a transfer.
    /// @param btcAddress   The Bitcoin address of the transfer.
    /// @param nonce        The incrementing nonce for the Bitcoin address in the transfer
    /// @return             The unique id for the transfer.
    function getTransferId(
        string memory btcAddress,
        uint256 nonce
    )
    public
    pure
    returns (bytes32)
    {
        return keccak256(abi.encodePacked("transfer:", btcAddress, ":", nonce));
    }

    /// @dev Get the next incrementing nonce for a Bitcoin address
    /// @param btcAddress   The Bitcoin address.
    /// @return             The next incrementing nonce for the Bitcoin address.
    function getNextNonce(
        string calldata btcAddress
    )
    external
    view
    returns (uint8)
    {
        return nextNonces[btcAddress];
    }

    /// @dev Calculate the fee that's paid for a transfer, according to the current fee structure, in satoshi.
    /// @param amountSatoshi    Amount of (r)BTC to transfer, in satoshi.
    /// @return                 The fee that will be paid, in satoshi.
    function calculateCurrentFeeSatoshi(
        uint256 amountSatoshi
    )
    public
    view
    returns (uint256) {
        return baseFeeSatoshi + (amountSatoshi * dynamicFee / DYNAMIC_FEE_DIVISOR);
    }

    /// @dev Calculate the fee that's paid for a transfer, according to the current fee structure, in wei.
    /// This is a pure utility function to be used in DAPPs.
    /// @param amountWei        Amount of rBTC to transfer, in wei.
    /// @return                 The fee that will be paid, in wei.
    function calculateCurrentFeeWei(
        uint256 amountWei
    )
    external
    view
    returns (uint256) {
        uint256 amountSatoshi = amountWei / SATOSHI_DIVISOR;
        return calculateCurrentFeeSatoshi(amountSatoshi) * SATOSHI_DIVISOR;
    }

    /// @dev Get a stored transfer based on transfer id.
    /// @dev If the transfer doesn't exist, revert.
    /// @param transferId   The unique identifier of the transfer.
    /// @return transfer    The stored BitcoinTransfer object
    function getTransferByTransferId(
        bytes32 transferId
    )
    public
    view
    returns (BitcoinTransfer memory transfer) {
        transfer = transfers[transferId];
        require(transfer.status != BitcoinTransferStatus.NOT_APPLICABLE, "Transfer doesn't exist");
    }

    /// @dev Get a stored transfer based on Bitcoin address and nonce.
    /// @dev If the transfer doesn't exist, revert.
    /// @param btcAddress   The Bitcoin address
    /// @param nonce        The Incrementing nonce
    /// @return transfer    The stored BitcoinTransfer object
    function getTransfer(
        string calldata btcAddress,
        uint8 nonce
    )
    external
    view
    returns (BitcoinTransfer memory transfer) {
        bytes32 transferId = getTransferId(btcAddress, nonce);
        transfer = getTransferByTransferId(transferId);
    }

    /// @dev Get multiple transfers by unique transfer ids
    /// @dev If the any of the transfers doesn't exist, revert.
    /// @param transferIds  An array of unique transfer ids.
    /// @return ret         An array of stored BitcoinTransfer objects.
    function getTransfersByTransferId(
        bytes32[] calldata transferIds
    )
    external
    view
    returns (BitcoinTransfer[] memory ret) {
        ret = new BitcoinTransfer[](transferIds.length);
        unchecked {
            for (uint256 i = 0; i < transferIds.length; i++) {
                ret[i] = transfers[transferIds[i]];
                require(ret[i].status != BitcoinTransferStatus.NOT_APPLICABLE, "Transfer doesn't exist");
            }
        }
    }

    /// @dev Get multiple transfers by Bitcoin addresses and nonces.
    /// @dev If the any of the transfers doesn't exist, revert.
    /// @param btcAddresses An array of Bitcoin address
    /// @param nonces       An array of nonces (indexes and length must match btcAddresses)
    /// @return ret         An array of stored BitcoinTransfer objects.
    function getTransfers(
        string[] calldata btcAddresses,
        uint8[] calldata nonces
    )
    external
    view
    returns (BitcoinTransfer[] memory ret) {
        require(btcAddresses.length == nonces.length, "same amount of btcAddresses and nonces must be given");
        ret = new BitcoinTransfer[](btcAddresses.length);
        unchecked {
            for (uint256 i = 0; i < btcAddresses.length; i++) {
                ret[i] = transfers[getTransferId(btcAddresses[i], nonces[i])];
                require(ret[i].status != BitcoinTransferStatus.NOT_APPLICABLE, "Transfer doesn't exist");
            }
        }
    }

    /// @dev An utility method to determine if a string is a valid Bitcoin address.
    /// Just delegates to BTCAddressValidator
    /// @param btcAddress   A (possibly invalid) Bitcoin address.
    /// @return             True if the address is a valid Bitcoin address, else false.
    function isValidBtcAddress(
        string memory btcAddress
    )
    public
    view
    returns (bool)
    {
        return btcAddressValidator.isValidBtcAddress(btcAddress);
    }

    /// @dev An utility method to get the list of federators. Just delegates to FastBTCAccessControl.
    /// @return addresses   An array of federator addresses.
    function federators()
    external
    view
    returns (address[] memory addresses)
    {
        addresses = accessControl.federators();
    }

    /// @dev Encode rskAddress and btcAddress to be used as userData in the token bridge
    /// @param rskAddress   The end-user's RSK (or other blockchain) address that transfers the rBTC
    /// @param btcAddress   The Bitcoin address to transfer the BTC to.
    /// @return userData    Parameters encoded in bytes, passable to bridge/aggregator methods.
    function encodeBridgeUserData(
        address rskAddress,
        string calldata btcAddress
    )
    external
    pure
    returns (bytes memory userData)
    {
        userData = abi.encode(rskAddress, btcAddress);
    }

    /// @dev Decode rskAddress and btcAddress out of userData passed from the token bridge.
    /// @param userData     Parameters encoded in bytes, as it comes from the token bridge.
    /// @return rskAddress  The end-user's RSK (or other blockchain) address that transfers the rBTC
    /// @return btcAddress  The Bitcoin address to transfer the BTC to.
    function decodeBridgeUserData(
        bytes calldata userData
    )
    public
    pure
    returns (address rskAddress, string memory btcAddress)
    {
        (rskAddress, btcAddress) = abi.decode(userData, (address, string));
    }

    // ADMIN API
    // =========

    /// @dev Updates the Bitcoin address validator used.
    /// Can only be called by admins.
    /// @param newBtcAddressValidator   Address of the new BTCAddressValidator.
    function setBtcAddressValidator(
        IBTCAddressValidator newBtcAddressValidator
    )
    external
    onlyAdmin
    {
        require(address(newBtcAddressValidator) != address(0), "Cannot set to zero address");
        btcAddressValidator = newBtcAddressValidator;
    }

    /// @dev Add a new fee structure.
    /// Can only be called by admins.
    /// Note that there's a limit on how many can be added, and once added, fee structures cannot be removed.
    /// @param feeStructureIndex    The index of the new fee structure
    ///                             A fee structure must not already exist in this index.
    /// @param newBaseFeeSatoshi    The base fee to be used for the fee structure, in satoshi.
    /// @param newDynamicFee        The dynamic fee to be used for the fee structure, in satoshi.
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

    /// @dev Change the current fee structure to the one in the given index.
    /// Can only be called by admins.
    /// @param feeStructureIndex    The index of the fee structure. A fee structure must exist in this index.
    function setCurrentFeeStructure(
        uint256 feeStructureIndex
    )
    external
    onlyAdmin
    {
        _setCurrentFeeStructure(feeStructureIndex);
    }

    /// @dev Set the minimum amount that can be transferred, in satoshi.
    /// Can only be called by admins.
    /// @param newMinTransferSatoshi    The new minimum transfer amount, in satoshi.
    function setMinTransferSatoshi(
        uint256 newMinTransferSatoshi
    )
    external
    onlyAdmin
    {
        require(newMinTransferSatoshi <= type(uint40).max, "Must fit in uint40");
        minTransferSatoshi = uint40(newMinTransferSatoshi);
    }

    /// @dev Set the maximum amount that can be transferred, in satoshi.
    /// Can only be called by admins.
    /// @param newMaxTransferSatoshi    The new maximum transfer amount, in satoshi.
    function setMaxTransferSatoshi(
        uint256 newMaxTransferSatoshi
    )
    external
    onlyAdmin
    {
        require(newMaxTransferSatoshi <= type(uint40).max, "Must fit in uint40");
        maxTransferSatoshi = uint40(newMaxTransferSatoshi);
    }

    function setRequiredBlocksBeforeReclaim(
        uint256 newRequiredBlocksBeforeReclaim
    )
    external
    onlyAdmin
    {
        require(
            newRequiredBlocksBeforeReclaim <= MAX_REQUIRED_BLOCKS_BEFORE_RECLAIM,
            "Required blocks before reclaim too large"
        );
        requiredBlocksBeforeReclaim = uint32(newRequiredBlocksBeforeReclaim);
    }

    // TODO: figure out if we want to lock this so that only fees can be retrieved
    /// @dev Withdraw rBTC from the contract.
    /// Can only be called by admins.
    /// @param amount   The amount of rBTC to withdraw (in wei).
    /// @param receiver The address to send the rBTC to.
    function withdrawRbtc(
        uint256 amount,
        address payable receiver
    )
    external
    onlyAdmin
    {
        receiver.sendValue(amount);
    }

    /// @dev A utility for withdrawing tokens accidentally sent to the contract.
    /// Can only be called by admins.
    /// @param token    The ERC20 token to withdraw.
    /// @param amount   The amount of the token to withdraw (in wei/base units).
    /// @param receiver The address to send the tokens to.
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

    // PAUSING/FREEZING API
    // ====================

    /// @dev Pause the contract, stopping new transfers.
    /// Can only be called by pausers.
    function pause() external onlyPauser {
        _pause();
    }

    /// @dev Freeze the contract, disabling the use of federator methods as well as pausing it.
    /// Can only be called by guards.
    /// @dev This is intended only for emergencies (such as in the event of a hostile federator network),
    /// as it effectively stops the system from functioning at all.
    function freeze() external onlyGuard {
        if (!paused()) { // we don't want to risk a revert
            _pause();
        }
        _freeze();
    }

    /// @dev Unpause the contract, allowing new transfers again. Cannot unpause when frozen.
    /// After unfreezing, the contract needs to be unpaused manually.
    /// Can only be called by pausers.
    function unpause() external onlyPauser whenNotFrozen {
        _unpause();
    }

    /// @dev Unfreeze the contract, re-enabling the use of federator methods.
    /// Unfreezing does not automatically unpause the contract.
    /// Can only be called by guards.
    function unfreeze() external onlyGuard {
        _unfreeze();
        //_unpause(); // it's best to have the option unpause separately
    }
}
