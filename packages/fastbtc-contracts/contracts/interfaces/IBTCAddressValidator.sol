//SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

/// @title An interface for contracts that validate Bitcoin addresses.
interface IBTCAddressValidator {
    /// @dev Is the given string is a valid Bitcoin address?
    /// @param _btcAddress  A (possibly invalid) Bitcoin address.
    /// @return The validity of the address, as boolean.
    function isValidBtcAddress(
        string calldata _btcAddress
    )
    external
    view
    returns (bool);
}
