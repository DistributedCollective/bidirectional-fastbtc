//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract FastBTCBridge is AccessControlEnumerable {

    event Transfered(
        string _btcAddress,
        uint8 _nonce,
        uint64 _amountSatoshi,
        uint64 _feeSatoshi
    );

    struct Transfer {
        uint64 amountSatoshi;
        uint8 status;
    }

    bytes32 public constant ROLE_ADMIN = DEFAULT_ADMIN_ROLE;
    bytes32 public constant ROLE_FEDERATOR = keccak256("FEDERATOR");
    uint256 public constant SATOSHI_DIVISOR = 1 ether / 100_000_000;
    uint64 public constant DYNAMIC_FEE_DIVISOR = 10_000;

    uint64 public minTransferSatoshi = 1000;
    uint64 public maxTransferSatoshi = 100_000_000;
    uint64 public baseFeeSatoshi = 500;
    uint64 public dynamicFee = 1;  // 0.0001 = 0.01 %

    // TODO: would it be more efficient to use one of the following?
    // mapping(string => mapping(uint8 => Transfer));
    // mapping(bytes32 => Transfer); // Where bytes32 is keccak256(btcAddress, nonce);

    mapping(string => Transfer[]) public transfers;

    constructor() {
        _setupRole(ROLE_ADMIN, msg.sender);
    }

    function transferRBTCToBTC(
        string calldata _btcAddress,
        uint8 _nonce
    )
    external
    {
        require(_nonce == getNextNonce(_btcAddress), "Invalid nonce");
        require(_nonce != 255, "Maximum number of transfers for address exceeded");
        require(btcAddressValidator.isValidBTCAddress(_btcAddress), "Invalid BTC address");

        require(msg.value >= minTransferWei, "Min RBTC transfer amount not met");
        require(msg.value <= maxTransferWei, "Max RBTC transfer amount not met");
        require(msg.value % SATOSHI_DIVISOR == 0, "RBTC amount must be evenly divisible to Satoshis");

        uint64 amountSatoshi = uint64(msg.value / SATOSHI_DIVISOR);
        uint64 feeSatoshi = baseFeeSatoshi + (amountSatoshi * dynamicFee / DYNAMIC_FEE_DIVISOR);
        require(feeSatoshi < amountSatoshi, "Fee is greater than amount");
        amountSatoshi -= feeSatoshi;

        emit Transfered(
            _btcAddress,
            _nonce,
            amountSatoshi
        );
    }

    function voteForTransfer(
        string calldata _btcAddress,
        uint8 _nonce
    )
    public
    {

    }

    function getNextNonce(
        string calldata _btcAddress
    )
    public
    view
    returns(uint8)
    {
        uint256 length = transfers[_btcAddress].length;
        require(length <= 255);
        return uint8(length);
    }

    function isValidBTCAddress(
        string calldata _btcAddress
    )
    public
    view
    returns (bool)
    {
        // TODO: implement this
        return true;
    }

    // Utility functions
    function setMinTransferSatoshi(
        uint64 _minTransferSatoshi
    )
    external
    onlyRole(ROLE_ADMIN)
    {
        minTransferSatoshi = _minTransferSatoshi;
    }

    function setMaxTransferSatoshi(
        uint64 _maxTransferSatoshi
    )
    external
    onlyRole(ROLE_ADMIN)
    {
        require(_maxTransferSatoshi <= 21_000_000 * 100_000_000, "Would allow transfering more than all Bitcoin ever");
        maxTransferSatoshi = _maxTransferSatoshi;
    }

    function setBaseFeeSatoshi(
        uint64 _baseFeeSatoshi
    )
    external
    onlyRole(ROLE_ADMIN)
    {
        require(_baseFeeSatoshi <= 100_000_000, "Base fee too large");
        baseFeeSatoshi = _baseFeeSatoshi;
    }

    function setDynamicFee(
        uint64 _dynamicFee
    )
    external
    onlyRole(ROLE_ADMIN)
    {
        require(_dynamicFee <= DYNAMIC_FEE_DIVISOR, "Dynamic fee too large");
        dynamicFee = _dynamicFee;
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

}
