//SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

/// @title An interface for access-control-handling contracts (e.g. FastBTCAccessControl).
interface IFastBTCAccessControl {

    /// @dev Make sure that the given address is an admin, else revert.
    /// @param addressToCheck   The address to check.
    function checkAdmin(address addressToCheck) external view;

    /// @dev Make sure that the given address is a federator, else revert.
    /// @param addressToCheck   The address to check.
    function checkFederator(address addressToCheck) external view;

    /// @dev Make sure that the given address is a guard, else revert.
    /// @param addressToCheck   The address to check.
    function checkGuard(address addressToCheck) external view;

    /// @dev Make sure that the given address is a pauser, else revert.
    /// @param addressToCheck   The address to check.
    function checkPauser(address addressToCheck) external view;

    /// @dev Check that there are enough valid federator signatures for the given message hash.
    /// If even one signature is invalid, or if there are not enough signatures, revert.
    /// @param _messageHash The message hash that's signed.
    /// @param _signatures  An array of federator signatures for the message hash.
    function checkFederatorSignatures(bytes32 _messageHash, bytes[] memory _signatures) external view;

    /// @dev Get the number of federators in the system.
    /// @return The number of federators.
    function numFederators() external view
        returns (uint256);

    /// @dev Get the number of required federator signatures (a strict majority).
    /// @return The number of required federator signatures.
    function numRequiredFederators() external view
        returns (uint256);

    /// @dev Get the federator addresses of the system.
    /// @return addresses   An array of federator addresses.
    function federators() external view
        returns (address[] memory addresses);

    /// @dev Add a new federator to the system. Can only be called by admins.
    /// @param account  The address to grant federator role to.
    function addFederator(address account) external;

    /// @dev Remove federator from the system. Can only be called by admins.
    /// @param account  The address to remove the federator role from.
    function removeFederator(address account) external;

    /// @dev Add a new pauser to the system. Can only be called by admins.
    /// @param account  The address to grant pauser role to.
    function addPauser(address account) external;

    /// @dev Remove pauser from the system. Can only be called by admins.
    /// @param account  The address to remove the pauser role from.
    function removePauser(address account) external;

    /// @dev Add a new guard to the system. Can only be called by admins.
    /// @param account  The address to grant guard role to.
    function addGuard(address account) external;

    /// @dev Remove guard from the system. Can only be called by admins.
    /// @param account  The address to remove the guard role from.
    function removeGuard(address account) external;
}
