//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./FastBTCAccessControl.sol";

abstract contract FastBTCAccessControllable {
    FastBTCAccessControl public accessControl;

    constructor(
        FastBTCAccessControl _accessControl
    )
    {
        accessControl = _accessControl;
    }

    modifier onlyFederator() {
        accessControl.checkFederator(msg.sender);
        _;
    }

    modifier onlyAdmin() {
        accessControl.checkAdmin(msg.sender);
        _;
    }
}
