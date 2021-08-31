//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract FastBTCBridge is AccessControlEnumerable {
    using SafeERC20 for IERC20;

    event Transferred(
        string _btcAddress,
        uint _nonce,
        uint _amountSatoshi,
        uint _feeSatoshi
    );

    struct Transfer {
        address from;
        uint amountSatoshi;
        int status;
    }

    bytes32 public constant ROLE_ADMIN = DEFAULT_ADMIN_ROLE;
    bytes32 public constant ROLE_FEDERATOR = keccak256("FEDERATOR");
    uint256 public constant SATOSHI_DIVISOR = 1 ether / 100_000_000;
    uint public constant DYNAMIC_FEE_DIVISOR = 10_000;
    int public constant TRANSFER_STATUS_REGISTERED = 0;
    int public constant TRANSFER_STATUS_PROCESSED = 1;
    int public constant TRANSFER_STATUS_REFUNDED = -1;
    uint256 public constant MAX_DEPOSITS_PER_BTC_ADDRESS = 255;

    uint public minTransferSatoshi = 1000;
    uint public maxTransferSatoshi = 200_000_000; // 2 BTC
    uint public baseFeeSatoshi = 500;
    uint public dynamicFee = 1;  // 0.0001 = 0.01 %

    // TODO: would it be more efficient to use one of the following?
    // mapping(string => mapping(uint => Transfer));
    // mapping(bytes32 => Transfer); // Where bytes32 is keccak256(btcAddress, nonce);
    mapping(string => Transfer[]) public transfers;

    constructor() {
        _setupRole(ROLE_ADMIN, msg.sender);
    }

    function transferRBTCToBTC(
        string calldata _btcAddress,
        uint _nonce
    )
    external
    payable
    {
        require(_nonce == getNextNonce(_btcAddress), "Invalid nonce");
        require(_nonce < MAX_DEPOSITS_PER_BTC_ADDRESS, "Maximum number of transfers for address exceeded");

        require(msg.value >= minTransferSatoshi * SATOSHI_DIVISOR, "RBTC transfer smaller than minimum");
        require(msg.value <= maxTransferSatoshi * SATOSHI_DIVISOR, "RBTC transfer greater than maximum");
        require(msg.value % SATOSHI_DIVISOR == 0, "RBTC amount must be evenly divisible to Satoshis");

        require(isValidBTCAddress(_btcAddress), "Invalid BTC address");

        uint amountSatoshi = msg.value / SATOSHI_DIVISOR;
        uint feeSatoshi = baseFeeSatoshi + (amountSatoshi * dynamicFee / DYNAMIC_FEE_DIVISOR);
        require(feeSatoshi < amountSatoshi, "Fee is greater than amount");
        amountSatoshi -= feeSatoshi;

        transfers[_btcAddress].push(
            Transfer(
                msg.sender,
                amountSatoshi,
                TRANSFER_STATUS_REGISTERED
            )
        );

        emit Transferred(
            _btcAddress,
            _nonce,
            amountSatoshi,
            feeSatoshi
        );
    }

    function voteForTransfer(
        string calldata _btcAddress,
        uint _nonce
    )
    public
    {

    }

    function getNextNonce(
        string calldata _btcAddress
    )
    public
    view
    returns(uint)
    {
        return transfers[_btcAddress].length;
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
    function withdrawRBTC(
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
}
