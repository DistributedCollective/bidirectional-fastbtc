// SPDX-License-Identifier: MIT
// Forked from (and customized):
// OpenZeppelin Contracts v4.3.2 (security/Pausable.sol)

pragma solidity ^0.8.0;

/**
 * @dev Contract module which allows children to implement an emergency stop
 * mechanism that can be triggered by an authorized account.
 *
 * This module is used through inheritance. It will make available the
 * modifiers `whenNotFrozen` and `whenFrozen`, which can be applied to
 * the functions of your contract. Note that they will not be pausable by
 * simply including this module, only once the modifiers are put in place.
 */
abstract contract Freezable {
    /**
     * @dev Emitted when the freeze is triggered by `account`.
     */
    event Frozen(address account);

    /**
     * @dev Emitted when the freeze is lifted by `account`.
     */
    event Unfrozen(address account);

    bool private _frozen;

    /**
     * @dev Initializes the contract in unfrozen state.
     */
    constructor() {
        _frozen = false;
    }

    /**
     * @dev Returns true if the contract is frozen, and false otherwise.
     */
    function frozen() public view virtual returns (bool) {
        return _frozen;
    }

    /**
     * @dev Modifier to make a function callable only when the contract is not frozen.
     *
     * Requirements:
     *
     * - The contract must not be frozen.
     */
    modifier whenNotFrozen() {
        require(!frozen(), "Freezable: frozen");
        _;
    }

    /**
     * @dev Modifier to make a function callable only when the contract is frozen.
     *
     * Requirements:
     *
     * - The contract must be frozen.
     */
    modifier whenFrozen() {
        require(frozen(), "Freezable: not frozen");
        _;
    }

    /**
     * @dev Triggers stopped state.
     *
     * Requirements:
     *
     * - The contract must not be frozen.
     */
    function _freeze() internal virtual whenNotFrozen {
        _frozen = true;
        emit Frozen(msg.sender);
    }

    /**
     * @dev Returns to normal state.
     *
     * Requirements:
     *
     * - The contract must be frozen.
     */
    function _unfreeze() internal virtual whenFrozen {
        _frozen = false;
        emit Unfrozen(msg.sender);
    }
}