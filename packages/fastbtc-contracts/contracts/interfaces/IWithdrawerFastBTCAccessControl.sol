//SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

/// @title Interface to FastBTCAccessControl from the point of view of the Withdrawer contract
interface IWithdrawerFastBTCAccessControl {
    /// @dev The role that has admin privileges on the contract, with permissions to manage other roles and call
    /// admin-only functions.
    function ROLE_ADMIN() external view returns(bytes32);

    /// @dev Is `role` granted to `account`?
    function hasRole(bytes32 role, address account) external view returns (bool);
}
