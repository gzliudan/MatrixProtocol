// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";

// ==================== Internal Imports ====================

import { IController } from "../../interfaces/IController.sol";
import { IMatrixToken } from "../../interfaces/IMatrixToken.sol";

/**
 * @title  MatrixTokenAccessible
 *
 * Abstract class that houses permissioning of module for MatrixTokens.
 */
abstract contract MatrixTokenAccessible is AccessControl {
    // ==================== Constants ====================

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    // ==================== Variables ====================

    // Address of the controller
    IController private _controller;

    // MatrixToken => Whether MatrixToken is on allow list. Updateable by governance
    mapping(IMatrixToken => bool) public _allowedMatrixTokens;

    // Whether any MatrixToken can initialize this module. Updateable by governance.
    bool public _anyMatrixAllowed;

    // ==================== Events ====================

    /**
     * @dev Emitted on updateAllowedMatrixToken()
     *
     * @param matrixToken    MatrixToken being whose allowance to initialize this module is being updated
     * @param added          true if added false if removed
     */
    event UpdateMatrixTokenStatus(IMatrixToken indexed matrixToken, bool indexed added);

    /**
     * @dev Emitted on updateAnyMatrixAllowed()
     *
     * @param anyMatrixAllowed    true if any MatrixToken is allowed to initialize this module, false otherwise
     */
    event UpdateAnyMatrixAllowed(bool indexed anyMatrixAllowed);

    // ==================== Constructor function ====================

    /**
     * @param controller    Address of controller contract
     */
    constructor(IController controller) {
        _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _grantRole(ADMIN_ROLE, _msgSender());
        _controller = controller;
    }

    // ==================== Modifier functions ====================

    /**
     * @dev If anyMatrixAllowed is true or matrixToken is registered in allowedMatrixTokens, modifier succeeds.
     */
    modifier onlyAllowedMatrix(IMatrixToken matrixToken) {
        _onlyAllowedMatrix(matrixToken);
        _;
    }

    modifier onlyAdmin() {
        _onlyAdmin();
        _;
    }

    // ==================== External functions ====================

    /**
     * @dev GOVERNANCE ONLY: Enable/disable ability of a MatrixToken to initialize this module.
     *
     * @param matrixToken    Instance of the MatrixToken
     * @param status         Whether matrixToken is allowed to initialize this module
     */
    function updateAllowedMatrixToken(IMatrixToken matrixToken, bool status) public onlyAdmin {
        require(_controller.isMatrix(address(matrixToken)) || _allowedMatrixTokens[matrixToken], "TA0");
        _allowedMatrixTokens[matrixToken] = status;
        emit UpdateMatrixTokenStatus(matrixToken, status);
    }

    /**
     * @dev GOVERNANCE ONLY: Toggle whether ANY MatrixToken is allowed to initialize this module.
     *
     * @param anyMatrixAllowed             Bool indicating if ANY MatrixToken is allowed to initialize this module
     */
    function updateAnyMatrixAllowed(bool anyMatrixAllowed) public onlyAdmin {
        _anyMatrixAllowed = anyMatrixAllowed;
        emit UpdateAnyMatrixAllowed(_anyMatrixAllowed);
    }

    // ==================== Private functions ====================

    function _onlyAllowedMatrix(IMatrixToken matrixToken) private view {
        require(_anyMatrixAllowed || _allowedMatrixTokens[matrixToken], "TA1");
    }

    function _onlyAdmin() private view {
        require(hasRole(ADMIN_ROLE, _msgSender()), "TA2");
    }
}
