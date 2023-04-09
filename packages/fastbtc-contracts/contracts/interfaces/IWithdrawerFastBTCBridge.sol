//SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

/// @title Interface to FastBTCBridge, from the point of view of the Withdrawer contract
interface IWithdrawerFastBTCBridge {
    /// @dev return the address of the FastBTCAccessControl contract
    function accessControl() external view returns (address);

    /// @dev Withdraw rBTC from the contract.
    /// Can only be called by admins.
    /// @param amount   The amount of rBTC to withdraw (in wei).
    /// @param receiver The address to send the rBTC to.
    function withdrawRbtc(
        uint256 amount,
        address payable receiver
    )
    external;
}
