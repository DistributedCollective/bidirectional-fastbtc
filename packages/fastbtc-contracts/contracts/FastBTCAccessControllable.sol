//SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "./interfaces/IFastBTCAccessControl.sol";

abstract contract FastBTCAccessControllable {
    IFastBTCAccessControl public accessControl;

    constructor(
        address _accessControl
    )
    {
        accessControl = IFastBTCAccessControl(_accessControl);
    }

    modifier onlyFederator() {
        accessControl.checkFederator(msg.sender);
        _;
    }

    modifier onlyAdmin() {
        accessControl.checkAdmin(msg.sender);
        _;
    }

    modifier onlyPauser() {
        accessControl.checkPauser(msg.sender);
        _;
    }

    modifier onlyGuard() {
        accessControl.checkGuard(msg.sender);
        _;
    }
}
