//SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "@openzeppelin/contracts/access/IAccessControlEnumerable.sol";

interface IFastBTCAccessControl is IAccessControlEnumerable {
   
    function checkAdmin(address addressToCheck) external view;
    function checkFederator(address addressToCheck) external view;
    function checkGuard(address addressToCheck) external view;
    function checkPauser(address addressToCheck) external view;
    
    function checkFederatorSignatures(bytes32 _messageHash, bytes[] memory _signatures) external view;
    function numFederators() external view
        returns (uint256);
    function numRequiredFederators() external view
        returns (uint256);
    function federators() external view
        returns (address[] memory addresses);
        
    function addFederator(address account) external;    
    function removeFederator(address account) external;

}
