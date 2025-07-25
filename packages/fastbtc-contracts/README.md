fastbtc-contracts -- The Bidirectional FastBTC RSK Smart contracts
==================================================================

This package contains the smart contracts for bi-directional FastBTC. Hardhat is used as the development framework.

Contract overview
-----------------

The main contracts are:

- [FastBTCBridge](contracts/FastBTCBridge.sol): The main contract. Accepts rBTC transfers from users and transfer state
  updates from federators. Can be managed by admins and paused (new transfers disabled) or freezed (federator actions
  disabled too) by addresses with the right roles.
- [FastBTCAccessControl](contracts/FastBTCAccessControl.sol): Controls user roles and validates federator signatures.
  The contract is deployed as its own instance and is used by both FastBTCBridge and BTCAddressValidator.
  The supported roles are:
    - `ADMIN`: can manage roles and call administrative functions in other contracts 
    - `FEDERATOR`: can update transfer status and refund transfers with enough federator signatures
      (as well as participate in the P2P network)
    - `PAUSER`: can pause the FastBTCBridge contract, which disables new transfers.
    - `GUARD`: can freeze the FastBTCBridge contract, which disables federator actions as well as pausing it.
    - `CONFIG_ADMIN`: can set configuration values that can be read by nodes (upcoming feature)
- [BTCAddressValidator](contracts/BTCAddressValidator.sol): Contains Bitcoin address validation logic.

There are also a couple of utility contracts

- [Freezable](contracts/Freezable.sol): Contains freezing logic. Inherited contract.
- [FastBTCAccessControllable](contracts/FastBTCAccessControllable.sol): Contains reusable boilerplate for access
  control. Inherited contract.

All contracts build heavily on top of industry-standard OpenZeppelin contracts.


Building
--------

```
yarn
yarn build
# or npx hardhat compile
```

Running unit tests
------------------

```
yarn test
# or npx hardhat test
```

Deployment
----------

hardhat-deploy is used for deployments:

```
npx hardhat deploy --network NETWORK
```

Where network is the wanted network.

Utility scripts
---------------

[hardhat.config.ts](hardhat.config.ts) contains many utility scripts useful for development or maintenance.
Run `npx hardhat` or read the config to show the list.

### Managing Roles

The `roles` task allows you to check, add, or remove roles from addresses in the FastBTCAccessControl contract:

Possible roles: 'ADMIN', 'FEDERATOR', 'PAUSER', 'GUARD'

```bash
# Check all addresses with a specific role
npx hardhat --network <network> roles check --role <ROLE>

# Add a role to an address
npx hardhat --network <network> roles add --role <ROLE> --account <ADDRESS>

# Remove a role from an address
npx hardhat --network <network> roles remove --role <ROLE> --account <ADDRESS>
```

Example:
```bash
# Check all guards on RSK mainnet
npx hardhat --network rsk roles check --role GUARD --access-control <CONTRACT_ADDRESS>
npx hardhat --network rsk roles check --role GUARD --access-control 0xed47F7b0f9a71AE667194ac186e4d1932CE7a099

# Add a guard on testnet
npx hardhat --network rsk-testnet roles add --role GUARD --account 0x... --access-control <CONTRACT_ADDRESS>
```

Note: The `--access-control` parameter is optional. If not provided, the task will try to get the address from deployment records.


### Managing Bridge State (Pause/Freeze)

The `pause-freeze` task allows you to manage the FastBTCBridge contract's operational state:

```bash
npx hardhat --network <network> pause-freeze <action>
```

Where `<action>` is one of:
- `check`: Show current pause and freeze status
- `pause`: Disable new transfers (requires PAUSER role)
- `unpause`: Re-enable transfers (requires PAUSER role)
- `freeze`: Disable federator actions and pause transfers (requires GUARD role)
- `unfreeze`: Re-enable federator actions (requires GUARD role)

Optional parameters:
- `--bridge-address`: Specify the FastBTCBridge contract address, otherwise will try to get it from the deployment file
- `--private-key`: Use a specific private key instead of DEPLOYER_PRIVATE_KEY

Example:
```bash
# Check current status
npx hardhat --network rsk pause-freeze check

# Pause transfers
npx hardhat --network rsk pause-freeze pause

# Freeze all operations
npx hardhat --network rsk pause-freeze freeze
```

Note: After unfreezing, you'll need to explicitly unpause if you want to fully restore operations.

