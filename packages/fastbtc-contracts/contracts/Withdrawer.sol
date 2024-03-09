//SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "./FastBTCAccessControllable.sol";
import "./interfaces/IWithdrawerFastBTCBridge.sol";
import "./interfaces/IWithdrawerFastBTCAccessControl.sol";

/// @title Contract for withdrawing balances to another contract, e.g. the FastBTC-in ManagedWallet contract
/// @notice This contract is set as an admin to the FastBTCBridge contract, and can then be used by federators
/// to withdraw balances to a pre-set contract.
contract Withdrawer is FastBTCAccessControllable {
    /// @dev Emitted when rBTC is withdrawn.
    event Withdrawal(
        uint256 amount
    );

    /// @dev Emitted when the max amount that can be withdrawn in a single transaction is changed.
    event MaxWithdrawableUpdated(
        uint256 newMaxWithdrawable
    );

    /// @dev Emitted when the min time between withdrawals is changed.
    event MinTimeBetweenWithdrawalsUpdated(
        uint256 newMinTimeBetweenWithdrawals
    );

    /// @dev The FastBTCBridge contract.
    IWithdrawerFastBTCBridge public immutable fastBtcBridge;

    /// @dev The address the rBTC is withdrawn to. Intentionally non-changeable for security.
    address payable public immutable receiver;

    /// @dev Max amount withdrawable in a single transaction
    uint256 public maxWithdrawable = 10 ether;

    /// @dev Minimum time that has to pass between withdrawals
    uint256 public minTimeBetweenWithdrawals = 1 days;

    /// @dev Last time the contract was withdrawn from
    uint256 public lastWithdrawTimestamp = 0;

    constructor(
        IWithdrawerFastBTCBridge _fastBtcBridge,
        address payable _receiver
    )
    FastBTCAccessControllable(_fastBtcBridge.accessControl())
    {
        fastBtcBridge = _fastBtcBridge;
        receiver = _receiver;
    }

    // MAIN API
    // ========

    /// @dev Withdraw rBTC from the contract to the pre-set receiver. Can only be called by federators.
    /// @notice This intentionally only requires a single federator, as
    /// @param amount   The amount of rBTC to withdraw (in wei).
    function withdrawRbtcToReceiver(
        uint256 amount
    )
    external
    onlyFederator
    {
        require(amount > 0, "cannot withdraw zero amount");
        require(amount <= maxWithdrawable, "amount too high");
        require(block.timestamp - lastWithdrawTimestamp >= minTimeBetweenWithdrawals, "too soon");

        lastWithdrawTimestamp = block.timestamp;

        fastBtcBridge.withdrawRbtc(amount, receiver);

        emit Withdrawal(amount);
    }

    // ADMIN API
    // =========

    /// @dev Set the max amount that can be withdrawn in a single transaction.
    /// Can only be called by admins.
    /// @param _maxWithdrawable The max amount that can be withdrawn in a single transaction.
    function setMaxWithdrawable(
        uint256 _maxWithdrawable
    )
    external
    onlyAdmin
    {
        if (_maxWithdrawable == maxWithdrawable) {
            return;
        }
        maxWithdrawable = _maxWithdrawable;
        emit MaxWithdrawableUpdated(_maxWithdrawable);
    }

    /// @dev Set the min time between withdrawals.
    /// Can only be called by admins.
    /// @param _minTimeBetweenWithdrawals The min time between withdrawals.
    function setMinTimeBetweenWithdrawals(
        uint256 _minTimeBetweenWithdrawals
    )
    external
    onlyAdmin
    {
        if (_minTimeBetweenWithdrawals == minTimeBetweenWithdrawals) {
            return;
        }
        minTimeBetweenWithdrawals = _minTimeBetweenWithdrawals;
        emit MinTimeBetweenWithdrawalsUpdated(_minTimeBetweenWithdrawals);
    }

    // PUBLIC VIEWS
    // ============

    /// @dev Get the amount of rBTC that can be withdrawn this very moment.
    function amountWithdrawable() external view returns (uint256 withdrawable) {
        if (!hasWithdrawPermissions()) {
            return 0;
        }

        if (block.timestamp - lastWithdrawTimestamp < minTimeBetweenWithdrawals) {
            return 0;
        }

        /// @dev the older version of FastBTCBridge doesn't have this function, so we will revert to balance check
        try fastBtcBridge.totalAdminWithdrawableRbtc() returns (uint256 totalAdminWithdrawableRbtc) {
            withdrawable = totalAdminWithdrawableRbtc;
        } catch {
            withdrawable = address(fastBtcBridge).balance;
        }

        if (withdrawable > maxWithdrawable) {
            withdrawable = maxWithdrawable;
        }
    }

    /// @dev Check if the contract has withdraw permissions.
    function hasWithdrawPermissions() public view returns (bool) {
        IWithdrawerFastBTCAccessControl control = IWithdrawerFastBTCAccessControl(address(accessControl));
        return control.hasRole(control.ROLE_ADMIN(), address(this));
    }

    /// @dev Get the timestamp of the next time the contract can be withdrawn from.
    function nextPossibleWithdrawTimestamp() external view returns (uint256) {
        return lastWithdrawTimestamp + minTimeBetweenWithdrawals;
    }

    /// @dev Get the balance of the receiver address.
    function receiverBalance() external view returns (uint256) {
        return receiver.balance;
    }
}
