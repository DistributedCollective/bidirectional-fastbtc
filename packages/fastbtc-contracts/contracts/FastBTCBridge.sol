//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./interfaces/IBTCAddressValidator.sol";
import "./FastBTCAccessControl.sol";
import "./FastBTCAccessControllable.sol";

contract FastBTCBridge is FastBTCAccessControllable {
    using SafeERC20 for IERC20;

    event NewTransfer(
        bytes32 _transferId,
        string _btcAddress,
        uint _nonce,
        uint _amountSatoshi,
        uint _feeSatoshi,
        address _rskAddress
    );

    event TransferStatusUpdated(
        bytes32 _transferId,
        int _newStatus
    );

    struct Transfer {
        int status;
        string btcAddress;
        uint nonce;
        uint amountSatoshi;
        uint feeSatoshi;
        address rskAddress;
    }

    uint256 public constant SATOSHI_DIVISOR = 1 ether / 100_000_000;
    uint public constant DYNAMIC_FEE_DIVISOR = 10_000;
    int public constant TRANSFER_STATUS_NEW = 1; // not 0 to make checks easier
    int public constant TRANSFER_STATUS_SENT = 3;
    int public constant TRANSFER_STATUS_REFUNDED = -2;
    uint256 public constant MAX_DEPOSITS_PER_BTC_ADDRESS = 255;

    IBTCAddressValidator public btcAddressValidator;

    uint public minTransferSatoshi = 1000;
    uint public maxTransferSatoshi = 200_000_000; // 2 BTC
    uint public baseFeeSatoshi = 500;
    uint public dynamicFee = 1;  // 0.0001 = 0.01 %

    mapping(bytes32 => Transfer) public transfers;
    mapping(string => uint) public nextNonces;

    constructor(
        FastBTCAccessControl _accessControl,
        IBTCAddressValidator _btcAddressValidator
    )
    FastBTCAccessControllable(_accessControl)
    {
        btcAddressValidator = _btcAddressValidator;
    }

    function transferToBtc(
        string calldata _btcAddress,
        uint _nonce
    )
    external
    payable
    {
        require(isValidBtcAddress(_btcAddress), "Invalid BTC address");

        require(_nonce == getNextNonce(_btcAddress), "Invalid nonce");
        require(_nonce <= MAX_DEPOSITS_PER_BTC_ADDRESS, "Maximum number of transfers for address exceeded");

        require(msg.value >= minTransferSatoshi * SATOSHI_DIVISOR, "RBTC transfer smaller than minimum");
        require(msg.value <= maxTransferSatoshi * SATOSHI_DIVISOR, "RBTC transfer greater than maximum");
        require(msg.value % SATOSHI_DIVISOR == 0, "RBTC amount must be evenly divisible to Satoshis");

        uint amountSatoshi = msg.value / SATOSHI_DIVISOR;
        uint feeSatoshi = calculateFeeSatoshi(amountSatoshi);
        require(feeSatoshi < amountSatoshi, "Fee is greater than amount");
        amountSatoshi -= feeSatoshi;

        bytes32 transferId = getTransferId(_btcAddress, _nonce);
        require(transfers[transferId].status == 0, "Transfer already exists"); // shouldn't happen ever
        transfers[transferId] = Transfer(
            TRANSFER_STATUS_NEW,
            _btcAddress,
            _nonce,
            amountSatoshi,
            feeSatoshi,
            msg.sender
        );
        nextNonces[_btcAddress]++;

        emit NewTransfer(
            transferId,
            _btcAddress,
            _nonce,
            amountSatoshi,
            feeSatoshi,
            msg.sender
        );
    }

    // TODO:
    // - limit federator-only actions
    // - marking as processed
    // - reclaiming

    function markTransfersAsSent(
        bytes32[] calldata _transferIds
    )
    public
    onlyFederator
    {
        // TODO: check signatures
        for (uint i = 0; i < _transferIds.length; i++) {
            Transfer storage transfer = transfers[_transferIds[i]];
            require(transfer.status == TRANSFER_STATUS_NEW, "invalid existing transfer status or transfer not found");
            transfer.status = TRANSFER_STATUS_SENT;
            emit TransferStatusUpdated(
                _transferIds[i],
                TRANSFER_STATUS_SENT
            );
        }
    }

    function getTransferId(
        string calldata _btcAddress,
        uint nonce
    )
    public
    pure
    returns (bytes32)
    {
        return keccak256(abi.encodePacked(_btcAddress, ":", nonce));
    }

    function getNextNonce(
        string calldata _btcAddress
    )
    public
    view
    returns (uint)
    {
        return nextNonces[_btcAddress];
    }

    function calculateFeeSatoshi(
        uint amountSatoshi
    )
    public
    view
    returns (uint) {
        return baseFeeSatoshi + (amountSatoshi * dynamicFee / DYNAMIC_FEE_DIVISOR);
    }

    /// @dev pure utility function to be used in DApps
    function calculateFeeWei(
        uint256 amountWei
    )
    public
    view
    returns (uint) {
        uint amountSatoshi = amountWei / SATOSHI_DIVISOR;
        return calculateFeeSatoshi(amountSatoshi) * SATOSHI_DIVISOR;
    }

    // TODO: maybe get rid of this -- it's needlessly duplicated to preserve backwards compatibility
    function isValidBtcAddress(
        string calldata _btcAddress
    )
    public
    view
    returns (bool)
    {
        return btcAddressValidator.isValidBtcAddress(_btcAddress);
    }

    // TODO: maybe get rid of this -- it's needlessly duplicated to preserve backwards compatibility
    function federators()
    public
    view
    returns (address[] memory addresses)
    {
        return accessControl.federators();
    }


    // Utility functions
    function setBtcAddressValidator(
        IBTCAddressValidator _btcAddressValidator
    )
    external
    onlyAdmin
    {
        btcAddressValidator = _btcAddressValidator;
    }

    function setMinTransferSatoshi(
        uint _minTransferSatoshi
    )
    external
    onlyAdmin
    {
        minTransferSatoshi = _minTransferSatoshi;
    }

    function setMaxTransferSatoshi(
        uint _maxTransferSatoshi
    )
    external
    onlyAdmin
    {
        require(_maxTransferSatoshi <= 21_000_000 * 100_000_000, "Would allow transferring more than all Bitcoin ever");
        maxTransferSatoshi = _maxTransferSatoshi;
    }

    function setBaseFeeSatoshi(
        uint _baseFeeSatoshi
    )
    external
    onlyAdmin
    {
        require(_baseFeeSatoshi <= 100_000_000, "Base fee too large");
        baseFeeSatoshi = _baseFeeSatoshi;
    }

    function setDynamicFee(
        uint _dynamicFee
    )
    external
    onlyAdmin
    {
        require(_dynamicFee <= DYNAMIC_FEE_DIVISOR, "Dynamic fee too large");
        dynamicFee = _dynamicFee;
    }

    // TODO: figure out if we want to lock this so that only fees can be retrieved
    /// @dev utility for withdrawing RBTC from the contract
    function withdrawRbtc(
        uint256 _amount,
        address payable _receiver
    )
    external
    onlyAdmin
    {
        _receiver.transfer(_amount);
    }

    /// @dev utility for withdrawing tokens accidentally sent to the contract
    function withdrawTokens(
        IERC20 _token,
        uint256 _amount,
        address _receiver
    )
    external
    onlyAdmin
    {
        _token.safeTransfer(_receiver, _amount);
    }
}
