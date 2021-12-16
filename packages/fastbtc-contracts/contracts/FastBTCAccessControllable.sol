//SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "./interfaces/IFastBTCAccessControl.sol";

/// @title An utility mixin to inherit contracts that require access control from.
abstract contract FastBTCAccessControllable {
    /// @dev The FastBTCAccessControl address.
    IFastBTCAccessControl public accessControl;

    /// @dev The constructor.
    /// @param _accessControl   The FastBTCAccessControl address.
    constructor(
        address _accessControl
    )
    {
        accessControl = IFastBTCAccessControl(_accessControl);
    }

    /// @dev A modifier that ensures only a federator can call a function.
    modifier onlyFederator() {
        accessControl.checkFederator(msg.sender);
        _;
    }

    /// @dev A modifier that ensures only an admin can call a function.
    modifier onlyAdmin() {
        accessControl.checkAdmin(msg.sender);
        _;
    }

    /// @dev A modifier that ensures only a pauser can call a function.
    modifier onlyPauser() {
        accessControl.checkPauser(msg.sender);
        _;
    }

    /// @dev A modifier that ensures only a guard can call a function.
    modifier onlyGuard() {
        accessControl.checkGuard(msg.sender);
        _;
    }
}
