//SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

interface IBTCAddressValidator {
    function isValidBtcAddress(
        string calldata _btcAddress
    )
    external
    view
    returns (bool);
}
