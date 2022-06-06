//SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./interfaces/IFastBTCAccessControl.sol";

/// @title The contract that handles the role-based access control of the other bi-directional FastBTC contracts.
contract FastBTCAccessControl is IFastBTCAccessControl, AccessControlEnumerable {
    /// @dev The role that has admin privileges on the contract, with permissions to manage other roles and call
    /// admin-only functions.
    bytes32 public constant ROLE_ADMIN = DEFAULT_ADMIN_ROLE;

    /// @dev The role given to federators that track and update the status of rBTC-to-BTC transfers in the system.
    bytes32 public constant ROLE_FEDERATOR = keccak256("FEDERATOR");

    /// @dev The role given to pausers. Pausers can pause the contracts, blocking new rBTC-to-BTC transfers.
    bytes32 public constant ROLE_PAUSER = keccak256("PAUSER");

    /// @dev The role given to guards. Guards can freeze the contracts, disabling federator actions, as well as
    /// pausing the contracts.
    bytes32 public constant ROLE_GUARD = keccak256("GUARD");

    /// @dev The role given to configuration admins. Configuration admins can change the online configuration
    /// key-value pair that affect certain federator node behaviour.
    bytes32 public constant ROLE_CONFIG_ADMIN = keccak256("CONFIG_ADMIN");


    /// @dev The constructor.
    constructor() {
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /// @dev Make sure that the given address is an admin, else revert.
    /// @param addressToCheck   The address to check.
    function checkAdmin(
        address addressToCheck
    )
    external
    view
    {
        _checkRole(ROLE_ADMIN, addressToCheck);
    }

    /// @dev Make sure that the given address is a pauser, else revert.
    /// @param addressToCheck   The address to check.
    function checkPauser(
        address addressToCheck
    )
    external
    view
    {
        if (!hasRole(DEFAULT_ADMIN_ROLE, addressToCheck)) {
            _checkRole(ROLE_PAUSER, addressToCheck);
        }
    }

    /// @dev Make sure that the given address is a guard, else revert.
    /// @param addressToCheck   The address to check.
    function checkGuard(
        address addressToCheck
    )
    external
    view
    {
        if (!hasRole(DEFAULT_ADMIN_ROLE, addressToCheck)) {
            _checkRole(ROLE_GUARD, addressToCheck);
        }
    }

    /// @dev Make sure that the given address is a configuration admin, else revert.
    /// @param addressToCheck   The address to check.
    function checkConfigAdmin(
        address addressToCheck
    )
    external
    view
    {
        if (!hasRole(DEFAULT_ADMIN_ROLE, addressToCheck)) {
            _checkRole(ROLE_CONFIG_ADMIN, addressToCheck);
        }
    }

    /// @dev Make sure that the given address is a federator, else revert.
    /// @param addressToCheck   The address to check.
    function checkFederator(
        address addressToCheck
    )
    public
    view
    {
        _checkRole(ROLE_FEDERATOR, addressToCheck);
    }

    /// @dev Check that there are enough valid federator signatures for the given message hash.
    /// If even one signature is invalid, or if there are not enough signatures, revert.
    /// @param _messageHash The message hash that's signed.
    /// @param _signatures  An array of federator signatures for the message hash.
    function checkFederatorSignatures(
        bytes32 _messageHash,
        bytes[] memory _signatures
    )
    external
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

    /// @dev Get the number of federators in the system.
    /// @return The number of federators.
    function numFederators()
    public
    view
    returns (uint)
    {
        return getRoleMemberCount(ROLE_FEDERATOR);
    }

    /// @dev Get the number of required federator signatures (a strict majority).
    /// @return The number of required federator signatures.
    function numRequiredFederators()
    public
    view
    returns (uint)
    {
        return getRoleMemberCount(ROLE_FEDERATOR) / 2 + 1;
    }

    /// @dev Get the federator addresses of the system.
    /// @return addresses   An array of federator addresses.
    function federators()
    external
    view
    returns (address[] memory addresses)
    {
        uint256 count = numFederators();
        addresses = new address[](count);
        for(uint256 i = 0; i < count; i++) {
            addresses[i] = getRoleMember(ROLE_FEDERATOR, i);
        }
    }

    /// @dev Grant a role to an account. Overridden from AccessControlEnumerable to allow custom checks.
    /// Can only be called by admins.
    /// @param role     The role to grant.
    /// @param account  The address to grant the role to.
    function grantRole(
        bytes32 role,
        address account
    )
    public
    override
    {
        require(account != address(0), "Cannot grant role to zero address");
        super.grantRole(role, account);  // enforces onlyAdmin
    }

    /// @dev Add a new federator to the system. Can only be called by admins.
    /// @param account  the address to grant the federator role to.
    function addFederator(
        address account
    )
    external
    {
        grantRole(ROLE_FEDERATOR, account); // enforces onlyAdmin
    }

    /// @dev Remove federator from the system. Can only be called by admins.
    /// @param account  The address to revoke the federator role from.
    function removeFederator(
        address account
    )
    external
    {
        revokeRole(ROLE_FEDERATOR, account); // enforces onlyAdmin
    }

    /// @dev Add a new pauser to the system. Can only be called by admins.
    /// @param account  the address to grant the pauser role to.
    function addPauser(
        address account
    )
    external
    {
        grantRole(ROLE_PAUSER, account); // enforces onlyAdmin
    }

    /// @dev Remove pauser from the system. Can only be called by admins.
    /// @param account  The address to revoke the pauser role from.
    function removePauser(
        address account
    )
    external
    {
        revokeRole(ROLE_PAUSER, account); // enforces onlyAdmin
    }

    /// @dev Add a new guard to the system. Can only be called by admins.
    /// @param account  the address to grant the guard role to.
    function addGuard(
        address account
    )
    external
    {
        grantRole(ROLE_GUARD, account); // enforces onlyAdmin
    }

    /// @dev Remove guard from the system. Can only be called by admins.
    /// @param account  The address to revoke the guard role from.
    function removeGuard(
        address account
    )
    external
    {
        revokeRole(ROLE_GUARD, account); // enforces onlyAdmin
    }

    /// @dev Add a new configuration admin to the system. Can only be called by admins.
    /// @param account  the address to grant the configuration admin role to.
    function addConfigAdmin(
        address account
    )
    external
    {
        grantRole(ROLE_CONFIG_ADMIN, account); // enforces onlyAdmin
    }

    /// @dev Remove a configuration admin from the system. Can only be called by admins.
    /// @param account  The address to revoke the guard role from.
    function removeConfigAdmin(
        address account
    )
    external
    {
        revokeRole(ROLE_CONFIG_ADMIN, account); // enforces onlyAdmin
    }
}
