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
