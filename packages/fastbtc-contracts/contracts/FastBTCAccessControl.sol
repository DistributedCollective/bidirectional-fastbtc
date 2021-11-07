//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract FastBTCAccessControl is AccessControlEnumerable {
    bytes32 public constant ROLE_ADMIN = DEFAULT_ADMIN_ROLE;
    bytes32 public constant ROLE_FEDERATOR = keccak256("FEDERATOR");
    bytes32 public constant ROLE_PAUSER = keccak256("PAUSER");
    bytes32 public constant ROLE_GUARD = keccak256("GUARD");

    constructor() {
        _setupRole(ROLE_ADMIN, msg.sender);
        _setupRole(ROLE_PAUSER, msg.sender);
        _setupRole(ROLE_GUARD, msg.sender);
    }

    function checkAdmin(
        address addressToCheck
    )
    public
    view
    {
        _checkRole(ROLE_ADMIN, addressToCheck);
    }

    function checkPauser(
        address addressToCheck
    )
    public
    view
    {
       if (!hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            _checkRole(ROLE_PAUSER, addressToCheck);
        }
    }

    function checkGuard(
        address addressToCheck
    )
    public
    view
    {
        if (!hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            _checkRole(ROLE_GUARD, addressToCheck);
        }
    }

    function checkFederator(
        address addressToCheck
    )
    public
    view
    {
        _checkRole(ROLE_FEDERATOR, addressToCheck);
    }

    function checkFederatorSignatures(
        bytes32 _messageHash,
        bytes[] memory _signatures
    )
    public
    view
    {
        _messageHash = ECDSA.toEthSignedMessageHash(_messageHash);

        uint numRequired = numRequiredFederators();
        require(_signatures.length >= numRequired, "Not enough signatures");

        address[] memory seen = new address[](_signatures.length);
        for (uint i = 0; i < _signatures.length; i++) {
            address recovered = ECDSA.recover(_messageHash, _signatures[i]);
            require(recovered != address(0), "recover failed");
            checkFederator(recovered);
            for (uint j = 0; j < i; j++) {
                require(seen[j] != recovered, "already signed by federator");
            }
            seen[i] = recovered;
        }
    }

    function numFederators()
    public
    view
    returns (uint)
    {
        return getRoleMemberCount(ROLE_FEDERATOR);
    }

    function numRequiredFederators()
    public
    view
    returns (uint)
    {
        return getRoleMemberCount(ROLE_FEDERATOR) / 2 + 1;
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
