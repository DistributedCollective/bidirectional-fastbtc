//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./FastBTCAccessControl.sol";
import "./FastBTCAccessControllable.sol";

contract BTCAddressValidator is FastBTCAccessControllable {
    constructor(
        FastBTCAccessControl _accessControl
    )
    FastBTCAccessControllable(_accessControl)
    {
    }

    function isValidBtcAddress(
        string calldata _btcAddress
    )
    public
    view
    returns (bool)
    {
        // TODO: support bech32
        // - validate prefix, bc (or bc1?) or tb, depending on deployment
        // - make sure they are lowercase
        // - do the checksum validation if feasible with gas costs in mind
        // TODO: support configurable prefixes
        bytes memory _btcAddressBytes = bytes(_btcAddress);
        // The wiki gives these numbers as valid values for address length
        // (https://en.bitcoin.it/wiki/Invoice_address)
        if (_btcAddressBytes.length < 26 || _btcAddressBytes.length > 35) {
            return false;
        }
        if (
            uint8(_btcAddressBytes[0]) != 0x31 && uint8(_btcAddressBytes[0]) != 0x33
            && uint8(_btcAddressBytes[0]) != 0x6d // "m" for testnet, TODO: remove maybe
        ) {
            // doesn't start with 1 or 3
            // bech32 addresses and testnet addresses won't fit this check
            return false;
        }
        for (uint i = 1; i < _btcAddressBytes.length; i++) {
            uint8 c = uint8(_btcAddressBytes[i]);
            bool isValidCharacter = (
            (c >= 0x31 && c <= 0x39) // between "1" and "9" (0 is not valid)
            ||
            (c >= 0x41 && c <= 0x5a && c != 0x49 && c != 0x4f) // between "A" and "Z" but not "I" or "O"
            ||
            (c >= 0x61 && c <= 0x7a && c != 0x6c) // between "a" and "z" but not "l"
            );
            if (!isValidCharacter) {
                return false;
            }
        }
        return true;
    }
}
