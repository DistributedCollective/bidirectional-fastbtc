//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./interfaces/IBTCAddressValidator.sol";
import "./FastBTCAccessControllable.sol";

contract BTCAddressValidator is IBTCAddressValidator, FastBTCAccessControllable {
    string public bech32Prefix;
    bool supportsBech32;
    string[] public nonBech32Prefixes;

    // The wiki gives these numbers as valid values for address length
    // (https://en.bitcoin.it/wiki/Invoice_address)
    uint256 public bech32MinLength = 42; // 44 for regtest
    uint256 public bech32MaxLength = 60;
    uint256 public nonBech32MinLength = 26;
    uint256 public nonBech32MaxLength = 35;

    constructor(
        address _accessControl,
        string memory _bech32Prefix,
        string[] memory _nonBech32Prefixes
    )
    FastBTCAccessControllable(_accessControl)
    {
        bech32Prefix = _bech32Prefix;
        supportsBech32 = bytes(bech32Prefix).length > 0;
        nonBech32Prefixes = _nonBech32Prefixes;
    }

    function isValidBtcAddress(
        string calldata _btcAddress
    )
    external
    view
    override
    returns (bool)
    {
        if (supportsBech32 && startsWith(_btcAddress, bech32Prefix)) {
            return validateBech32Address(_btcAddress);
        } else {
            return validateNonBech32Address(_btcAddress);
        }
    }

    function validateBech32Address(
        string calldata _btcAddress
    )
    private
    view
    returns (bool)
    {
        // TODO:
        // - do the checksum validation if feasible with gas costs in mind
        // - could see if someone has already done this in a library

        bytes memory _btcAddressBytes = bytes(_btcAddress);
        if (_btcAddressBytes.length < bech32MinLength || _btcAddressBytes.length > bech32MaxLength) {
            return false;
        }

        for (uint i = bytes(bech32Prefix).length; i < _btcAddressBytes.length; i++) {
            if(
                _btcAddressBytes[i] == bytes1("1") ||
                _btcAddressBytes[i] == bytes1("b") ||
                _btcAddressBytes[i] == bytes1("i") ||
                _btcAddressBytes[i] == bytes1("o")
            ) {
                return false;
            }

            uint8 c = uint8(_btcAddressBytes[i]);
            bool isValidCharacter = (
                (c >= 0x30 && c <= 0x39) // between "0" and "9"
                ||
                (c >= 0x61 && c <= 0x7a) // between "a" and "z" (lowercase)
            );
            if (!isValidCharacter) {
                return false;
            }
        }
        return true;
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
        supportsBech32 = bytes(bech32Prefix).length > 0;
    }

    function setNonBech32Prefixes(
        string[] memory _prefixes
    )
    external
    onlyAdmin
    {
        nonBech32Prefixes = _prefixes;
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
