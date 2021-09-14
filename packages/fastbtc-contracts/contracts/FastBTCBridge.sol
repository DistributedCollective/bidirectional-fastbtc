//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract FastBTCBridge is AccessControlEnumerable {
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

    bytes32 public constant ROLE_ADMIN = DEFAULT_ADMIN_ROLE;
    bytes32 public constant ROLE_FEDERATOR = keccak256("FEDERATOR");
    uint256 public constant SATOSHI_DIVISOR = 1 ether / 100_000_000;
    uint public constant DYNAMIC_FEE_DIVISOR = 10_000;
    int public constant TRANSFER_STATUS_NEW = 1; // not 0 to make checks easier
    int public constant TRANSFER_STATUS_SENT = 3;
    int public constant TRANSFER_STATUS_REFUNDED = -2;
    uint256 public constant MAX_DEPOSITS_PER_BTC_ADDRESS = 255;

    uint public minTransferSatoshi = 1000;
    uint public maxTransferSatoshi = 200_000_000; // 2 BTC
    uint public baseFeeSatoshi = 500;
    uint public dynamicFee = 1;  // 0.0001 = 0.01 %

    mapping(bytes32 => Transfer) public transfers;
    mapping(string => uint) public nextNonces;

    constructor() {
        _setupRole(ROLE_ADMIN, msg.sender);
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
    public // TODO: should be federator only!
    {
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
    returns(uint)
    {
        return nextNonces[_btcAddress];
    }

    function isValidBtcAddress(
        string calldata _btcAddress
    )
    public
    pure
    returns (bool)
    {
        // TODO: support bech32
        // - validate prefix, bc (or bc1?) or tb, depending on deployment
        // - make sure they are lowercase
        // - do the checksum validation if feasible with gas costs in mind
        // TODO: support configurable prefixes
        bytes memory _btcAddressBytes = bytes(_btcAddress);
        // The wiki gives these numbers as valid values for address length
        // (https://en.bitcoin.it/wiki/Invoice_address)
        if (_btcAddressBytes.length < 26 || _btcAddressBytes.length > 35) {
            return false;
        }
        if (
            uint8(_btcAddressBytes[0]) != 0x31 && uint8(_btcAddressBytes[0]) != 0x33
            && uint8(_btcAddressBytes[0]) != 0x6d // "m" for testnet, TODO: remove maybe
        ) {
            // doesn't start with 1 or 3
            // bech32 addresses and testnet addresses won't fit this check
            return false;
        }
        for (uint i = 1; i < _btcAddressBytes.length; i++) {
            uint8 c = uint8(_btcAddressBytes[i]);
            bool isValidCharacter = (
                (c >= 0x31 && c <= 0x39) // between "1" and "9" (0 is not valid)
                ||
                (c >= 0x41 && c <= 0x5a && c != 0x49 && c != 0x4f) // between "A" and "Z" but not "I" or "O"
                ||
                (c >= 0x61 && c <= 0x7a && c != 0x6c) // between "a" and "z" but not "l"
            );
            if (!isValidCharacter) {
                return false;
            }
        }
        return true;
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

    // Utility functions
    function setMinTransferSatoshi(
        uint _minTransferSatoshi
    )
    external
    onlyRole(ROLE_ADMIN)
    {
        minTransferSatoshi = _minTransferSatoshi;
    }

    function setMaxTransferSatoshi(
        uint _maxTransferSatoshi
    )
    external
    onlyRole(ROLE_ADMIN)
    {
        require(_maxTransferSatoshi <= 21_000_000 * 100_000_000, "Would allow transferring more than all Bitcoin ever");
        maxTransferSatoshi = _maxTransferSatoshi;
    }

    function setBaseFeeSatoshi(
        uint _baseFeeSatoshi
    )
    external
    onlyRole(ROLE_ADMIN)
    {
        require(_baseFeeSatoshi <= 100_000_000, "Base fee too large");
        baseFeeSatoshi = _baseFeeSatoshi;
    }

    function setDynamicFee(
        uint _dynamicFee
    )
    external
    onlyRole(ROLE_ADMIN)
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
    onlyRole(ROLE_ADMIN)
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
    onlyRole(ROLE_ADMIN)
    {
        _token.safeTransfer(_receiver, _amount);
    }

    function toLower(
        string memory str
    )
    internal
    pure
    returns(string memory)
    {
        // https://gist.github.com/ottodevs/c43d0a8b4b891ac2da675f825b1d1dbf#gistcomment-3310614
        bytes memory bStr = bytes(str);
        bytes memory bLower = new bytes(bStr.length);
        for (uint i = 0; i < bStr.length; i++) {
            // Uppercase character...
            if ((uint8(bStr[i]) >= 65) && (uint8(bStr[i]) <= 90)) {
                // So we add 32 to make it lowercase
                bLower[i] = bytes1(uint8(bStr[i]) + 32);
            } else {
                bLower[i] = bStr[i];
            }
        }
        return string(bLower);
    }
}
