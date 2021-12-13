// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// ==================== Internal Imports ====================

import { IController } from "../../../interfaces/IController.sol";
import { ModuleBase } from "../../../protocol/lib/ModuleBase.sol";
import { IMatrixToken } from "../../../interfaces/IMatrixToken.sol";

contract ModuleBaseMock is ModuleBase {
    // ==================== Variables ====================

    bool public _removed;

    // ==================== Constructor function ====================

    constructor(IController controller) ModuleBase(controller) {}

    // ==================== External functions ====================

    function isRemoved() external view returns (bool) {
        return _removed;
    }

    function testIsMatrixPendingInitialization(IMatrixToken matrixToken) external view returns (bool) {
        return isMatrixPendingInitialization(matrixToken);
    }

    function testIsMatrixManager(IMatrixToken matrixToken, address addr) external view returns (bool) {
        return isMatrixManager(matrixToken, addr);
    }

    function testIsMatrixValidAndInitialized(IMatrixToken matrixToken) external view returns (bool) {
        return isMatrixValidAndInitialized(matrixToken);
    }

    function testOnlyManagerAndValidSet(IMatrixToken matrixToken) external view onlyManagerAndValidMatrix(matrixToken) {}

    function testGetAndValidateAdapter(string memory integrationName) external view returns (address) {
        return getAndValidateAdapter(integrationName);
    }

    function testGetAndValidateAdapterWithHash(bytes32 integrationHash) external view returns (address) {
        return getAndValidateAdapterWithHash(integrationHash);
    }

    function testGetModuleFee(uint256 feeIndex, uint256 quantity) external view returns (uint256) {
        return getModuleFee(feeIndex, quantity);
    }

    function testOnlySetManager(IMatrixToken matrixToken) external view onlyMatrixManager(matrixToken, msg.sender) {}

    function testOnlyModule(IMatrixToken matrixToken) external view onlyModule(matrixToken) {}

    function testOnlyValidAndInitializedSet(IMatrixToken matrixToken) external view onlyValidAndInitializedMatrix(matrixToken) {}

    function testOnlyValidInitialization(IMatrixToken matrixToken) external view onlyValidAndPendingMatrix(matrixToken) {}

    function testTransferFrom(
        IERC20 token,
        address from,
        address to,
        uint256 quantity
    ) external {
        transferFrom(token, from, to, quantity);
    }

    function testPayProtocolFeeFromMatrixToken(
        IMatrixToken matrixToken,
        address component,
        uint256 feeQuantity
    ) external {
        payProtocolFeeFromMatrixToken(matrixToken, component, feeQuantity);
    }

    function initializeModuleOnMatrix(IMatrixToken matrixToken) external {
        matrixToken.initializeModule();
    }

    function removeModule() external override {
        _removed = true;
    }
}
