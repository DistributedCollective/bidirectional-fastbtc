//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./interfaces/IBTCAddressValidator.sol";
import "./FastBTCAccessControllable.sol";

contract BTCAddressValidator is IBTCAddressValidator, FastBTCAccessControllable {
    string public bech32Prefix;
    bool supportsLegacy;
    string[] public nonBech32Prefixes;

    // The wiki gives these numbers as valid values for address length
    // (https://en.bitcoin.it/wiki/Invoice_address)
    uint256 public bech32MinLength = 42; // 44 for regtest
    uint256 public bech32MaxLength = 64; // 62 for others, 64 for regtest
    uint256 public nonBech32MinLength = 26;
    uint256 public nonBech32MaxLength = 35;
    uint256 public bech32PrefixLength;

    // bech32 allowed characters are ascii lowercase less 1, b, i, o
    uint256 public invalidBech32 = 0xfffffffffffffffffffffffffffffffff8008205fffffffffc02ffffffffffff;

    constructor(
        address _accessControl,
        string memory _bech32Prefix,
        string[] memory _nonBech32Prefixes
    )
    FastBTCAccessControllable(_accessControl)
    {
        bech32Prefix = _bech32Prefix;
        supportsLegacy = _nonBech32Prefixes.length > 0;
        nonBech32Prefixes = _nonBech32Prefixes;
        bech32PrefixLength = bytes(_bech32Prefix).length;
    }

    function isValidBtcAddress(
        string calldata _btcAddress
    )
    external
    view
    override
    returns (bool)
    {
        if (startsWith(_btcAddress, bech32Prefix)) {
            return validateBech32Address(_btcAddress);
        } else if (supportsLegacy) {
            return validateNonBech32Address(_btcAddress);
        }
        else return false;
    }

    function validateBech32Address(
        string calldata _btcAddress
    )
    private
    view
    returns (bool)
    {
        // TODO:
        // - could see if someone has already done this in a library,
        // this does not validate the actual address

        bytes memory _btcAddressBytes = bytes(_btcAddress);
        if (_btcAddressBytes.length < bech32MinLength || _btcAddressBytes.length > bech32MaxLength) {
            return false;
        }

        uint256 bitmask = 0;
        // for each character set the corresponding bit in the bitmask
        for (uint256 i = bytes(bech32Prefix).length; i < _btcAddressBytes.length; i++) {
            bitmask |= uint256(1) << uint8(_btcAddressBytes[i]);
        }

        // if any bit in the bitmask thus set corresponds to a character considered invalid
        // in bech32, raise an error here.
        return (bitmask & invalidBech32) == 0;
    }

    function validateNonBech32Address(
        string calldata _btcAddress
    )
    private
    view
    returns (bool)
    {
        bytes memory _btcAddressBytes = bytes(_btcAddress);

        if (_btcAddressBytes.length < nonBech32MinLength || _btcAddressBytes.length > nonBech32MaxLength) {
            return false;
        }

        if (!hasValidNonBech32Prefix(_btcAddress)) {
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

    function hasValidNonBech32Prefix(
        string calldata _btcAddress
    )
    private
    view
    returns (bool) {
        for (uint i = 0; i < nonBech32Prefixes.length; i++) {
            if (startsWith(_btcAddress, nonBech32Prefixes[i])) {
                return true;
            }
        }

        return false;
    }

    function startsWith(
        string calldata _string,
        string memory _prefix
    )
    private
    pure
    returns (bool) {
        bytes memory _stringBytes = bytes(_string);
        bytes memory _prefixBytes = bytes(_prefix);
        if (_prefixBytes.length > _stringBytes.length) {
            return false;
        }
        for (uint i = 0; i < _prefixBytes.length; i++) {
            if (_stringBytes[i] != _prefixBytes[i]) {
                return false;
            }
        }
        return true;
    }

    // ADMIN API

    function setBech32Prefix(
        string memory _prefix
    )
    external
    onlyAdmin
    {
        bech32Prefix = _prefix;
        bech32PrefixLength = bytes(_prefix).length;
    }

    function setNonBech32Prefixes(
        string[] memory _prefixes
    )
    external
    onlyAdmin
    {
        nonBech32Prefixes = _prefixes;
        supportsLegacy = nonBech32Prefixes.length > 0;
    }

    function setBech32MinAndMaxLengths(
        uint256 _minLength,
        uint256 _maxLength
    )
    external
    onlyAdmin
    {
        require(_minLength <= _maxLength, "minLength greater than maxLength");
        bech32MinLength = _minLength;
        bech32MaxLength = _maxLength;
    }

    function setNonBech32MinAndMaxLengths(
        uint256 _minLength,
        uint256 _maxLength
    )
    external
    onlyAdmin
    {
        require(_minLength <= _maxLength, "minLength greater than maxLength");
        nonBech32MinLength = _minLength;
        nonBech32MaxLength = _maxLength;
    }
}
