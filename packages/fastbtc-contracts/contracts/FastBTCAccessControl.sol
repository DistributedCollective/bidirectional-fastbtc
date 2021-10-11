//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";

contract FastBTCAccessControl is AccessControlEnumerable {
    bytes32 public constant ROLE_ADMIN = DEFAULT_ADMIN_ROLE;
    bytes32 public constant ROLE_FEDERATOR = keccak256("FEDERATOR");

    constructor() {
        _setupRole(ROLE_ADMIN, msg.sender);
    }

    function checkFederator(
        address addressToCheck
    )
    public
    view
    {
        _checkRole(ROLE_FEDERATOR, addressToCheck);
    }

    function checkAdmin(
        address addressToCheck
    )
    public
    view
    {
        _checkRole(ROLE_ADMIN, addressToCheck);
    }

    function numFederators()
    public
    view
    returns (uint)
    {
        return getRoleMemberCount(ROLE_FEDERATOR);
    }

    function federators()
    public
    view
    returns (address[] memory addresses)
    {
        uint256 count = numFederators();
        addresses = new address[](count);
        for(uint256 i = 0; i < count; i++) {
            addresses[i] = getRoleMember(ROLE_FEDERATOR, i);
        }
    }

    function addFederator(
        address account
    )
    public
    {
        grantRole(ROLE_FEDERATOR, account); // enforces onlyAdmin
    }

    function removeFederator(
        address account
    )
    public
    {
        revokeRole(ROLE_FEDERATOR, account); // enforces onlyAdmin
    }
}
