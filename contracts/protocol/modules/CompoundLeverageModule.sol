// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { SignedMath } from "@openzeppelin/contracts/utils/math/SignedMath.sol";
import { AccessControlEnumerable } from "@openzeppelin/contracts/access/AccessControlEnumerable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/security/ReentrancyGuard.sol";

// ==================== Internal Imports ====================

import { PreciseUnitMath } from "../../lib/PreciseUnitMath.sol";
import { AddressArrayUtil } from "../../lib/AddressArrayUtil.sol";

import { ModuleBase } from "../lib/ModuleBase.sol";
import { PositionUtil } from "../lib/PositionUtil.sol";

import { Compound } from "../integration/lib/Compound.sol";

import { ICErc20 } from "../../interfaces/external/ICErc20.sol";
import { IComptroller } from "../../interfaces/external/IComptroller.sol";

import { IController } from "../../interfaces/IController.sol";
import { IMatrixToken } from "../../interfaces/IMatrixToken.sol";
import { IExchangeAdapter } from "../../interfaces/IExchangeAdapter.sol";
import { IDebtIssuanceModule } from "../../interfaces/IDebtIssuanceModule.sol";

/**
 * @title CompoundLeverageModule
 *
 * @dev Smart contract that enables leverage trading using Compound as the lending protocol. This module is paired with
 * a debt issuance module that will call functions on this module to keep interest accrual and liquidation state updated.
 * This does not allow borrowing of assets from Compound alone. Each asset is leveraged when using this module.
 *
 * @notice Do not use this module in conjunction with other debt modules that allow Compound debt positions
 * as it could lead to double counting of debt when borrowed assets are the same.
 *
 */
contract CompoundLeverageModule is ModuleBase, ReentrancyGuard, AccessControlEnumerable {
    using SafeCast for int256;
    using SafeCast for uint256;
    using SignedMath for int256;
    using PreciseUnitMath for int256;
    using PreciseUnitMath for uint256;
    using AddressArrayUtil for address[];
    using Compound for IMatrixToken;
    using PositionUtil for IMatrixToken;

    // ==================== Constants ====================

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    /// @notice Governance must add DefaultIssuanceModule as the string as the integration name
    // String identifying the DebtIssuanceModule in the IntegrationRegistry.
    string internal constant DEFAULT_ISSUANCE_MODULE_NAME = "DefaultIssuanceModule";

    // 0 index stores protocol fee % on the controller, charged in the trade function
    uint256 internal constant PROTOCOL_TRADE_FEE_INDEX = 0;

    // ==================== Structs ====================

    struct EnabledAssets {
        address[] collateralCTokens; // Array of enabled cToken collateral assets for a MatrixToken
        address[] borrowCTokens; // Array of enabled cToken borrow assets for a MatrixToken
        address[] borrowAssets; // Array of underlying borrow assets that map to the array of enabled cToken borrow assets
    }

    struct ActionInfo {
        uint256 matrixTotalSupply; // Total supply of MatrixToken
        uint256 notionalSendQuantity; // Total notional quantity sent to exchange
        uint256 minNotionalReceiveQuantity; // Min total notional received from exchange
        uint256 preTradeReceiveTokenBalance; // Balance of pre-trade receive token balance
        IMatrixToken matrixToken; // MatrixToken instance
        IExchangeAdapter exchangeAdapter; // Exchange adapter instance
        ICErc20 collateralCTokenAsset; // Address of cToken collateral asset
        ICErc20 borrowCTokenAsset; // Address of cToken borrow asset
    }

    // ==================== Variables ====================

    // Mapping of underlying to CToken. If ETH, then map WETH to cETH
    mapping(IERC20 => ICErc20) public _underlyingToCToken;

    // Wrapped Ether address
    IERC20 internal _weth;

    // Compound cEther address
    ICErc20 internal _cEther;

    // Compound Comptroller contract
    IComptroller internal _comptroller;

    // COMP token address
    IERC20 internal _compToken;

    // Mapping to efficiently check if cToken market for collateral asset is valid in MatrixToken
    mapping(IMatrixToken => mapping(ICErc20 => bool)) public _collateralCTokenEnabled;

    // Mapping to efficiently check if cToken market for borrow asset is valid in MatrixToken
    mapping(IMatrixToken => mapping(ICErc20 => bool)) public _borrowCTokenEnabled;

    // Mapping of enabled collateral and borrow cTokens for syncing positions
    mapping(IMatrixToken => EnabledAssets) internal _enabledAssets;

    // Mapping of MatrixToken to boolean indicating if MatrixToken is on allow list. Updateable by governance
    mapping(IMatrixToken => bool) public _allowedMatrixTokens;

    // Boolean that returns if any MatrixToken can initialize this module. If false, then subject to allow list
    bool public _anyMatrixAllowed;

    // ==================== Events ====================

    event IncreaseLeverage(
        IMatrixToken indexed matrixToken,
        IERC20 indexed borrowAsset,
        IERC20 indexed collateralAsset,
        IExchangeAdapter exchangeAdapter,
        uint256 totalBorrowAmount,
        uint256 totalReceiveAmount,
        uint256 protocolFee
    );

    event DecreaseLeverage(
        IMatrixToken indexed matrixToken,
        IERC20 indexed collateralAsset,
        IERC20 indexed repayAsset,
        IExchangeAdapter exchangeAdapter,
        uint256 totalRedeemAmount,
        uint256 totalRepayAmount,
        uint256 protocolFee
    );

    event UpdateCollateralAssets(IMatrixToken indexed matrixToken, bool indexed added, IERC20[] assets);
    event UpdateBorrowAssets(IMatrixToken indexed matrixToken, bool indexed added, IERC20[] assets);
    event UpdateMatrixTokenStatus(IMatrixToken indexed matrixToken, bool indexed added);
    event UpdateAnyMatrixAllowed(bool indexed anyMatrixAllowed);

    // ==================== Constructor function ====================

    /**
     * @dev Instantiate addresses. Underlying to cToken mapping is created.
     *
     * @param controller     Address of controller contract
     * @param compToken      Address of COMP token
     * @param comptroller    Address of Compound Comptroller
     * @param cEther         Address of _cEther contract
     * @param weth           Address of WETH contract
     */
    constructor(
        IController controller,
        IERC20 compToken,
        IComptroller comptroller,
        ICErc20 cEther,
        IERC20 weth,
        string memory name
    ) ModuleBase(controller, name) {
        _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _grantRole(ADMIN_ROLE, _msgSender());

        _compToken = compToken;
        _comptroller = comptroller;
        _cEther = cEther;
        _weth = weth;

        ICErc20[] memory cTokens = comptroller.getAllMarkets();

        for (uint256 i = 0; i < cTokens.length; i++) {
            ICErc20 cToken = cTokens[i];
            _underlyingToCToken[cToken == cEther ? weth : IERC20(cTokens[i].underlying())] = cToken;
        }
    }

    // ==================== Modifier functions ====================

    modifier onlyAdmin() {
        _onlyAdmin();
        _;
    }

    // ==================== External functions ====================

    /**
     * @dev Get enabled assets for MatrixToken.
     * Returns an array of enabled cTokens that are collateral assets and an array of underlying that are borrow assets.
     *
     * @return address[]    Collateral cToken assets that are enabled
     * @return address[]    Underlying borrowed assets that are enabled.
     */
    function getEnabledAssets(IMatrixToken matrixToken) external view returns (address[] memory, address[] memory) {
        return (_enabledAssets[matrixToken].collateralCTokens, _enabledAssets[matrixToken].borrowAssets);
    }

    /**
     * @dev MANAGER ONLY: Increases leverage for a given collateral position using an enabled borrow asset that is enabled.
     * Performs a DEX trade, exchanging the borrow asset for collateral asset.
     *
     * @param matrixToken           Instance of the MatrixToken
     * @param borrowAsset           Address of asset being borrowed for leverage
     * @param collateralAsset       Address of collateral asset (underlying of cToken)
     * @param borrowQuantity        Borrow quantity of asset in position units
     * @param minReceiveQuantity    Min receive quantity of collateral asset to receive post-trade in position units
     * @param tradeAdapterName      Name of trade adapter
     * @param tradeData             Arbitrary data for trade
     */
    function lever(
        IMatrixToken matrixToken,
        IERC20 borrowAsset,
        IERC20 collateralAsset,
        uint256 borrowQuantity,
        uint256 minReceiveQuantity,
        string memory tradeAdapterName,
        bytes memory tradeData
    ) external nonReentrant onlyManagerAndValidMatrix(matrixToken) {
        // For levering up, send quantity is derived from borrow asset and receive quantity is derived from collateral asset
        ActionInfo memory leverInfo = _createAndValidateActionInfo(
            matrixToken,
            borrowAsset,
            collateralAsset,
            borrowQuantity,
            minReceiveQuantity,
            tradeAdapterName,
            true
        );

        _borrow(leverInfo.matrixToken, leverInfo.borrowCTokenAsset, leverInfo.notionalSendQuantity);

        uint256 postTradeReceiveQuantity = _executeTrade(leverInfo, borrowAsset, collateralAsset, tradeData);
        uint256 protocolFee = _accrueProtocolFee(matrixToken, collateralAsset, postTradeReceiveQuantity);
        uint256 postTradeCollateralQuantity = postTradeReceiveQuantity - protocolFee;

        _mintCToken(leverInfo.matrixToken, leverInfo.collateralCTokenAsset, collateralAsset, postTradeCollateralQuantity);
        _updateLeverPositions(leverInfo, borrowAsset);

        emit IncreaseLeverage(
            matrixToken,
            borrowAsset,
            collateralAsset,
            leverInfo.exchangeAdapter,
            leverInfo.notionalSendQuantity,
            postTradeCollateralQuantity,
            protocolFee
        );
    }

    /**
     * @dev MANAGER ONLY: Decrease leverage for a given collateral position using an enabled borrow asset that is enabled
     *
     * @param matrixToken         Instance of the MatrixToken
     * @param collateralAsset     Address of collateral asset (underlying of cToken)
     * @param repayAsset          Address of asset being repaid
     * @param redeemQuantity      Quantity of collateral asset to delever
     * @param minRepayQuantity    Minimum amount of repay asset to receive post trade
     * @param tradeAdapterName    Name of trade adapter
     * @param tradeData           Arbitrary data for trade
     */
    function delever(
        IMatrixToken matrixToken,
        IERC20 collateralAsset,
        IERC20 repayAsset,
        uint256 redeemQuantity,
        uint256 minRepayQuantity,
        string memory tradeAdapterName,
        bytes memory tradeData
    ) external nonReentrant onlyManagerAndValidMatrix(matrixToken) {
        // Note: for delevering, send quantity is derived from collateral asset and receive quantity is derived from repay asset
        ActionInfo memory deleverInfo = _createAndValidateActionInfo(
            matrixToken,
            collateralAsset,
            repayAsset,
            redeemQuantity,
            minRepayQuantity,
            tradeAdapterName,
            false
        );

        _redeemUnderlying(deleverInfo.matrixToken, deleverInfo.collateralCTokenAsset, deleverInfo.notionalSendQuantity);

        uint256 postTradeReceiveQuantity = _executeTrade(deleverInfo, collateralAsset, repayAsset, tradeData);
        uint256 protocolFee = _accrueProtocolFee(matrixToken, repayAsset, postTradeReceiveQuantity);
        uint256 repayQuantity = postTradeReceiveQuantity - protocolFee;

        _repayBorrow(deleverInfo.matrixToken, deleverInfo.borrowCTokenAsset, repayAsset, repayQuantity);
        _updateLeverPositions(deleverInfo, repayAsset);

        emit DecreaseLeverage(
            matrixToken,
            collateralAsset,
            repayAsset,
            deleverInfo.exchangeAdapter,
            deleverInfo.notionalSendQuantity,
            repayQuantity,
            protocolFee
        );
    }

    /**
     * @dev MANAGER ONLY: Pays down the borrow asset to 0 selling off a given collateral asset.
     * Any extra received borrow asset is updated as equity. No protocol fee is charged.
     *
     * @param matrixToken         Instance of the MatrixToken
     * @param collateralAsset     Address of collateral asset (underlying of cToken)
     * @param repayAsset          Address of asset being repaid (underlying asset e.g. DAI)
     * @param redeemQuantity      Quantity of collateral asset to delever
     * @param tradeAdapterName    Name of trade adapter
     * @param tradeData           Arbitrary data for trade
     */
    function deleverToZeroBorrowBalance(
        IMatrixToken matrixToken,
        IERC20 collateralAsset,
        IERC20 repayAsset,
        uint256 redeemQuantity,
        string memory tradeAdapterName,
        bytes memory tradeData
    ) external nonReentrant onlyManagerAndValidMatrix(matrixToken) {
        uint256 notionalRedeemQuantity = redeemQuantity.preciseMul(matrixToken.totalSupply());

        require(_borrowCTokenEnabled[matrixToken][_underlyingToCToken[repayAsset]], "CL0");
        uint256 notionalRepayQuantity = _underlyingToCToken[repayAsset].borrowBalanceCurrent(address(matrixToken));

        ActionInfo memory deleverInfo = _createAndValidateActionInfoNotional(
            matrixToken,
            collateralAsset,
            repayAsset,
            notionalRedeemQuantity,
            notionalRepayQuantity,
            tradeAdapterName,
            false
        );

        _redeemUnderlying(deleverInfo.matrixToken, deleverInfo.collateralCTokenAsset, deleverInfo.notionalSendQuantity);
        _executeTrade(deleverInfo, collateralAsset, repayAsset, tradeData);

        // We use notionalRepayQuantity vs. Compound's max value uint256(-1) to handle WETH properly
        _repayBorrow(deleverInfo.matrixToken, deleverInfo.borrowCTokenAsset, repayAsset, notionalRepayQuantity);

        // Update default position first to save gas on editing borrow position
        matrixToken.calculateAndEditDefaultPosition(address(repayAsset), deleverInfo.matrixTotalSupply, deleverInfo.preTradeReceiveTokenBalance);

        _updateLeverPositions(deleverInfo, repayAsset);

        emit DecreaseLeverage(
            matrixToken,
            collateralAsset,
            repayAsset,
            deleverInfo.exchangeAdapter,
            deleverInfo.notionalSendQuantity,
            notionalRepayQuantity,
            0 // No protocol fee
        );
    }

    /**
     * @dev CALLABLE BY ANYBODY: Sync Matrix positions with enabled Compound collateral and borrow positions.
     * For collateral assets, update cToken default position. For borrow assets, update external borrow position.
     * - Collateral assets may come out of sync when a position is liquidated
     * - Borrow assets may come out of sync when interest is accrued or position is liquidated and borrow is repaid
     *
     * @param matrixToken             Instance of the MatrixToken
     * @param shouldAccrueInterest    Boolean indicating whether use current block interest rate value or stored value
     */
    function sync(IMatrixToken matrixToken, bool shouldAccrueInterest) public nonReentrant onlyValidAndInitializedMatrix(matrixToken) {
        uint256 matrixTotalSupply = matrixToken.totalSupply();

        // Only sync positions when Matrix supply is not 0. This preserves debt and collateral positions on issuance / redemption
        if (matrixTotalSupply > 0) {
            // Loop through collateral assets
            address[] memory collateralCTokens = _enabledAssets[matrixToken].collateralCTokens;
            for (uint256 i = 0; i < collateralCTokens.length; i++) {
                ICErc20 collateralCToken = ICErc20(collateralCTokens[i]);
                uint256 previousPositionUnit = matrixToken.getDefaultPositionRealUnit(address(collateralCToken)).toUint256();
                uint256 newPositionUnit = _getCollateralPosition(matrixToken, collateralCToken, matrixTotalSupply);

                // Note: Accounts for if position does not exist on MatrixToken but is tracked in _enabledAssets
                if (previousPositionUnit != newPositionUnit) {
                    _updateCollateralPosition(matrixToken, collateralCToken, newPositionUnit);
                }
            }

            // Loop through borrow assets
            address[] memory borrowCTokens = _enabledAssets[matrixToken].borrowCTokens;
            address[] memory borrowAssets = _enabledAssets[matrixToken].borrowAssets;
            for (uint256 i = 0; i < borrowCTokens.length; i++) {
                ICErc20 borrowCToken = ICErc20(borrowCTokens[i]);
                IERC20 borrowAsset = IERC20(borrowAssets[i]);

                int256 previousPositionUnit = matrixToken.getExternalPositionRealUnit(address(borrowAsset), address(this));
                int256 newPositionUnit = _getBorrowPosition(matrixToken, borrowCToken, matrixTotalSupply, shouldAccrueInterest);

                // Note: Accounts for if position does not exist on MatrixToken but is tracked in _enabledAssets
                if (newPositionUnit != previousPositionUnit) {
                    _updateBorrowPosition(matrixToken, borrowAsset, newPositionUnit);
                }
            }
        }
    }

    /**
     * @dev MANAGER ONLY: Initializes this module to the MatrixToken. Only callable by the MatrixToken's manager.
     * @notice managers can enable collateral and borrow assets that don't exist as positions on the MatrixToken
     *
     * @param matrixToken         Instance of the MatrixToken to initialize
     * @param collateralAssets    Underlying tokens to be enabled as collateral in the MatrixToken
     * @param borrowAssets        Underlying tokens to be enabled as borrow in the MatrixToken
     */
    function initialize(
        IMatrixToken matrixToken,
        IERC20[] memory collateralAssets,
        IERC20[] memory borrowAssets
    ) external onlyMatrixManager(matrixToken, msg.sender) onlyValidAndPendingMatrix(matrixToken) {
        require(_anyMatrixAllowed || _allowedMatrixTokens[matrixToken], "CL1a");

        // Initialize module before trying register
        matrixToken.initializeModule();

        // Get debt issuance module registered to this module and require that it is initialized
        require(matrixToken.isInitializedModule(getAndValidateAdapter(DEFAULT_ISSUANCE_MODULE_NAME)), "CL1b");

        // Try if register exists on any of the modules including the debt issuance module
        address[] memory modules = matrixToken.getModules();
        for (uint256 i = 0; i < modules.length; i++) {
            try IDebtIssuanceModule(modules[i]).registerToIssuanceModule(matrixToken) {} catch {}
        }

        // Enable collateral and borrow assets on Compound
        addCollateralAssets(matrixToken, collateralAssets);
        addBorrowAssets(matrixToken, borrowAssets);
    }

    /**
     * @dev MANAGER ONLY: Removes this module from the MatrixToken, via call by the MatrixToken. Compound Settings
     * and manager enabled cTokens are deleted. Markets are exited on Comptroller (only valid if borrow balances are zero)
     */
    function removeModule() external override onlyValidAndInitializedMatrix(IMatrixToken(msg.sender)) {
        IMatrixToken matrixToken = IMatrixToken(msg.sender);

        // Sync Compound and MatrixToken positions prior to any removal action
        sync(matrixToken, true);

        address[] memory borrowCTokens = _enabledAssets[matrixToken].borrowCTokens;
        for (uint256 i = 0; i < borrowCTokens.length; i++) {
            ICErc20 cToken = ICErc20(borrowCTokens[i]);

            // Will exit only if token isn't also being used as collateral
            if (!_collateralCTokenEnabled[matrixToken][cToken]) {
                // Note: if there is an existing borrow balance, will revert and market cannot be exited on Compound
                matrixToken.invokeExitMarket(cToken, _comptroller);
            }

            delete _borrowCTokenEnabled[matrixToken][cToken];
        }

        address[] memory collateralCTokens = _enabledAssets[matrixToken].collateralCTokens;
        for (uint256 i = 0; i < collateralCTokens.length; i++) {
            ICErc20 cToken = ICErc20(collateralCTokens[i]);
            matrixToken.invokeExitMarket(cToken, _comptroller);
            delete _collateralCTokenEnabled[matrixToken][cToken];
        }

        delete _enabledAssets[matrixToken];

        // Try if unregister exists on any of the modules
        address[] memory modules = matrixToken.getModules();
        for (uint256 i = 0; i < modules.length; i++) {
            try IDebtIssuanceModule(modules[i]).unregisterFromIssuanceModule(matrixToken) {} catch {}
        }
    }

    /**
     * @dev MANAGER ONLY: Add registration of this module on debt issuance module for the MatrixToken.
     * @notice if the debt issuance module is not added to MatrixToken before this module is initialized, then this function
     * needs to be called if the debt issuance module is later added and initialized to prevent state inconsistencies.
     *
     * @param matrixToken           Instance of the MatrixToken
     * @param debtIssuanceModule    Debt issuance module address to register
     */
    function registerToModule(IMatrixToken matrixToken, IDebtIssuanceModule debtIssuanceModule) external onlyManagerAndValidMatrix(matrixToken) {
        require(matrixToken.isInitializedModule(address(debtIssuanceModule)), "CL2");

        debtIssuanceModule.registerToIssuanceModule(matrixToken);
    }

    /**
     * @dev MANAGER ONLY: Add enabled collateral assets. Collateral assets are tracked for syncing positions and entered in Compound markets
     *
     * @param matrixToken            Instance of the MatrixToken
     * @param newCollateralAssets    Addresses of new collateral underlying assets
     */
    function addCollateralAssets(IMatrixToken matrixToken, IERC20[] memory newCollateralAssets) public onlyManagerAndValidMatrix(matrixToken) {
        for (uint256 i = 0; i < newCollateralAssets.length; i++) {
            ICErc20 cToken = _underlyingToCToken[newCollateralAssets[i]];
            require(address(cToken) != address(0), "CL3a");
            require(!_collateralCTokenEnabled[matrixToken][cToken], "CL3b");

            // Note: Will only enter market if cToken is not enabled as a borrow asset as well
            if (!_borrowCTokenEnabled[matrixToken][cToken]) {
                matrixToken.invokeEnterMarkets(cToken, _comptroller);
            }

            _collateralCTokenEnabled[matrixToken][cToken] = true;
            _enabledAssets[matrixToken].collateralCTokens.push(address(cToken));
        }

        emit UpdateCollateralAssets(matrixToken, true, newCollateralAssets);
    }

    /**
     * @dev MANAGER ONLY: Remove collateral asset. Collateral asset exited in Compound markets
     * If there is a borrow balance, collateral asset cannot be removed
     *
     * @param matrixToken         Instance of the MatrixToken
     * @param collateralAssets    Addresses of collateral underlying assets to remove
     */
    function removeCollateralAssets(IMatrixToken matrixToken, IERC20[] memory collateralAssets) external onlyManagerAndValidMatrix(matrixToken) {
        // Sync Compound and MatrixToken positions prior to any removal action
        sync(matrixToken, true);

        for (uint256 i = 0; i < collateralAssets.length; i++) {
            ICErc20 cToken = _underlyingToCToken[collateralAssets[i]];
            require(_collateralCTokenEnabled[matrixToken][cToken], "CL4");

            // Note: Will only exit market if cToken is not enabled as a borrow asset as well
            // If there is an existing borrow balance, will revert and market cannot be exited on Compound
            if (!_borrowCTokenEnabled[matrixToken][cToken]) {
                matrixToken.invokeExitMarket(cToken, _comptroller);
            }

            delete _collateralCTokenEnabled[matrixToken][cToken];
            _enabledAssets[matrixToken].collateralCTokens.quickRemoveItem(address(cToken));
        }

        emit UpdateCollateralAssets(matrixToken, false, collateralAssets);
    }

    /**
     * @dev MANAGER ONLY: Add borrow asset. Borrow asset is tracked for syncing positions and entered in Compound markets
     *
     * @param matrixToken        Instance of the MatrixToken
     * @param newBorrowAssets    Addresses of borrow underlying assets to add
     */
    function addBorrowAssets(IMatrixToken matrixToken, IERC20[] memory newBorrowAssets) public onlyManagerAndValidMatrix(matrixToken) {
        for (uint256 i = 0; i < newBorrowAssets.length; i++) {
            IERC20 newBorrowAsset = newBorrowAssets[i];
            ICErc20 cToken = _underlyingToCToken[newBorrowAsset];
            require(address(cToken) != address(0), "CL5a");
            require(!_borrowCTokenEnabled[matrixToken][cToken], "CL5b");

            // Note: Will only enter market if cToken is not enabled as a borrow asset as well
            if (!_collateralCTokenEnabled[matrixToken][cToken]) {
                matrixToken.invokeEnterMarkets(cToken, _comptroller);
            }

            _borrowCTokenEnabled[matrixToken][cToken] = true;
            _enabledAssets[matrixToken].borrowCTokens.push(address(cToken));
            _enabledAssets[matrixToken].borrowAssets.push(address(newBorrowAsset));
        }

        emit UpdateBorrowAssets(matrixToken, true, newBorrowAssets);
    }

    /**
     * @dev MANAGER ONLY: Remove borrow asset. Borrow asset is exited in Compound markets
     * If there is a borrow balance, borrow asset cannot be removed
     *
     * @param matrixToken     Instance of the MatrixToken
     * @param borrowAssets    Addresses of borrow underlying assets to remove
     */
    function removeBorrowAssets(IMatrixToken matrixToken, IERC20[] memory borrowAssets) external onlyManagerAndValidMatrix(matrixToken) {
        // Sync Compound and MatrixToken positions prior to any removal action
        sync(matrixToken, true);

        for (uint256 i = 0; i < borrowAssets.length; i++) {
            ICErc20 cToken = _underlyingToCToken[borrowAssets[i]];
            require(_borrowCTokenEnabled[matrixToken][cToken], "CL6");

            // Note: Will only exit market if cToken is not enabled as a collateral asset as well
            // If there is an existing borrow balance, will revert and market cannot be exited on Compound
            if (!_collateralCTokenEnabled[matrixToken][cToken]) {
                matrixToken.invokeExitMarket(cToken, _comptroller);
            }

            delete _borrowCTokenEnabled[matrixToken][cToken];
            _enabledAssets[matrixToken].borrowCTokens.quickRemoveItem(address(cToken));
            _enabledAssets[matrixToken].borrowAssets.quickRemoveItem(address(borrowAssets[i]));
        }

        emit UpdateBorrowAssets(matrixToken, false, borrowAssets);
    }

    /**
     * @dev GOVERNANCE ONLY: Add or remove allowed MatrixToken to initialize this module. Only callable by governance.
     *
     * @param matrixToken    Instance of the MatrixToken
     */
    function updateAllowedMatrixToken(IMatrixToken matrixToken, bool status) external onlyAdmin {
        _allowedMatrixTokens[matrixToken] = status;

        emit UpdateMatrixTokenStatus(matrixToken, status);
    }

    /**
     * @dev GOVERNANCE ONLY: Toggle whether any MatrixToken is allowed to initialize this module. Only callable by governance.
     *
     * @param anyMatrixAllowed    Bool indicating whether _allowedMatrixTokens is enabled
     */
    function updateAnyMatrixAllowed(bool anyMatrixAllowed) external onlyAdmin {
        _anyMatrixAllowed = anyMatrixAllowed;

        emit UpdateAnyMatrixAllowed(anyMatrixAllowed);
    }

    /**
     * @dev GOVERNANCE ONLY: Add Compound market to module with stored underlying to cToken mapping in case of market additions to Compound.
     * IMPORTANT: Validations are skipped in order to get contract under bytecode limit
     *
     * @param cToken        Address of cToken to add
     * @param underlying    Address of underlying token that maps to cToken
     */
    function addCompoundMarket(ICErc20 cToken, IERC20 underlying) external onlyAdmin {
        require(address(_underlyingToCToken[underlying]) == address(0), "CL7");

        _underlyingToCToken[underlying] = cToken;
    }

    /**
     * @dev GOVERNANCE ONLY: Remove Compound market on stored underlying to cToken mapping in case of market removals
     * IMPORTANT: Validations are skipped in order to get contract under bytecode limit
     *
     * @param underlying    Address of underlying token to remove
     */
    function removeCompoundMarket(IERC20 underlying) external onlyAdmin {
        require(address(_underlyingToCToken[underlying]) != address(0), "CL8");

        delete _underlyingToCToken[underlying];
    }

    /**
     * @dev MODULE ONLY: Hook called prior to issuance to sync positions on MatrixToken. Only callable by valid module.
     *
     * @param matrixToken    Instance of the MatrixToken
     */
    function moduleIssueHook(
        IMatrixToken matrixToken,
        uint256 /* matrixTokenQuantity */
    ) external onlyModule(matrixToken) {
        sync(matrixToken, false);
    }

    /**
     * @dev MODULE ONLY: Hook called prior to redemption to sync positions on MatrixToken. For redemption,
     * always use current borrowed balance after interest accrual. Only callable by valid module.
     *
     * @param matrixToken    Instance of the MatrixToken
     */
    function moduleRedeemHook(
        IMatrixToken matrixToken,
        uint256 /* matrixTokenQuantity */
    ) external onlyModule(matrixToken) {
        sync(matrixToken, true);
    }

    /**
     * @dev MODULE ONLY: Hook called prior to looping through each component on issuance.
     * Invokes borrow in order for module to return debt to issuer. Only callable by valid module.
     *
     * @param matrixToken            Instance of the MatrixToken
     * @param matrixTokenQuantity    Quantity of MatrixToken
     * @param component              Address of component
     */
    function componentIssueHook(
        IMatrixToken matrixToken,
        uint256 matrixTokenQuantity,
        IERC20 component,
        bool /* isEquity */
    ) external onlyModule(matrixToken) {
        int256 componentDebt = matrixToken.getExternalPositionRealUnit(address(component), address(this));
        require(componentDebt < 0, "CL9");

        uint256 notionalDebt = componentDebt.abs().preciseMul(matrixTokenQuantity);
        _borrow(matrixToken, _underlyingToCToken[component], notionalDebt);
    }

    /**
     * @dev MODULE ONLY: Hook called prior to looping through each component on redemption.
     * Invokes repay after issuance module transfers debt from issuer. Only callable by valid module.
     *
     * @param matrixToken            Instance of the MatrixToken
     * @param matrixTokenQuantity    Quantity of MatrixToken
     * @param component              Address of component
     */
    function componentRedeemHook(
        IMatrixToken matrixToken,
        uint256 matrixTokenQuantity,
        IERC20 component,
        bool /* isEquity */
    ) external onlyModule(matrixToken) {
        int256 componentDebt = matrixToken.getExternalPositionRealUnit(address(component), address(this));
        require(componentDebt < 0, "CL10");

        uint256 notionalDebt = componentDebt.abs().preciseMulCeil(matrixTokenQuantity);
        _repayBorrow(matrixToken, _underlyingToCToken[component], component, notionalDebt);
    }

    // ==================== Internal functions ====================

    /**
     * @dev Mints the specified cToken from the underlying of the specified notional quantity.
     * If _cEther, the WETH must be unwrapped as it only accepts the underlying ETH.
     */
    function _mintCToken(
        IMatrixToken matrixToken,
        ICErc20 cToken,
        IERC20 underlyingToken,
        uint256 mintNotional
    ) internal {
        if (cToken == _cEther) {
            matrixToken.invokeUnwrapWETH(address(_weth), mintNotional);
            matrixToken.invokeMintCEther(cToken, mintNotional);
        } else {
            matrixToken.invokeSafeIncreaseAllowance(address(underlyingToken), address(cToken), mintNotional);
            matrixToken.invokeMintCToken(cToken, mintNotional);
        }
    }

    /**
     * @dev Invoke redeem from MatrixToken. If _cEther, then also wrap ETH into WETH.
     */
    function _redeemUnderlying(
        IMatrixToken matrixToken,
        ICErc20 cToken,
        uint256 redeemNotional
    ) internal {
        matrixToken.invokeRedeemUnderlying(cToken, redeemNotional);

        if (cToken == _cEther) {
            matrixToken.invokeWrapWETH(address(_weth), redeemNotional);
        }
    }

    /**
     * @dev Invoke repay from MatrixToken. If _cEther then unwrap WETH into ETH.
     */
    function _repayBorrow(
        IMatrixToken matrixToken,
        ICErc20 cToken,
        IERC20 underlyingToken,
        uint256 repayNotional
    ) internal {
        if (cToken == _cEther) {
            matrixToken.invokeUnwrapWETH(address(_weth), repayNotional);
            matrixToken.invokeRepayBorrowCEther(cToken, repayNotional);
        } else {
            matrixToken.invokeSafeIncreaseAllowance(address(underlyingToken), address(cToken), repayNotional);
            matrixToken.invokeRepayBorrowCToken(cToken, repayNotional);
        }
    }

    /**
     * @dev Invoke the MatrixToken to interact with the specified cToken to borrow the cToken's underlying of the specified borrowQuantity.
     */
    function _borrow(
        IMatrixToken matrixToken,
        ICErc20 cToken,
        uint256 notionalBorrowQuantity
    ) internal {
        matrixToken.invokeBorrow(cToken, notionalBorrowQuantity);
        if (cToken == _cEther) {
            matrixToken.invokeWrapWETH(address(_weth), notionalBorrowQuantity);
        }
    }

    /**
     * @dev Invokes approvals, gets trade call data from exchange adapter and invokes trade from MatrixToken
     *
     * @return receiveTokenQuantity    The quantity of tokens received post-trade
     */
    function _executeTrade(
        ActionInfo memory actionInfo,
        IERC20 _sendToken,
        IERC20 _receiveToken,
        bytes memory _data
    ) internal returns (uint256) {
        IMatrixToken matrixToken = actionInfo.matrixToken;
        uint256 notionalSendQuantity = actionInfo.notionalSendQuantity;
        matrixToken.invokeSafeIncreaseAllowance(address(_sendToken), actionInfo.exchangeAdapter.getSpender(), notionalSendQuantity);

        (address targetExchange, uint256 callValue, bytes memory methodData) = actionInfo.exchangeAdapter.getTradeCalldata(
            address(_sendToken),
            address(_receiveToken),
            address(matrixToken),
            notionalSendQuantity,
            actionInfo.minNotionalReceiveQuantity,
            _data
        );

        matrixToken.invoke(targetExchange, callValue, methodData);
        uint256 receiveTokenQuantity = _receiveToken.balanceOf(address(matrixToken)) - actionInfo.preTradeReceiveTokenBalance;
        require(receiveTokenQuantity >= actionInfo.minNotionalReceiveQuantity, "CL11");

        return receiveTokenQuantity;
    }

    /**
     * @dev Calculates protocol fee on module and pays protocol fee from MatrixToken
     */
    function _accrueProtocolFee(
        IMatrixToken matrixToken,
        IERC20 receiveToken,
        uint256 exchangedQuantity
    ) internal returns (uint256) {
        uint256 protocolFeeTotal = getModuleFee(PROTOCOL_TRADE_FEE_INDEX, exchangedQuantity);
        payProtocolFeeFromMatrixToken(matrixToken, address(receiveToken), protocolFeeTotal);

        return protocolFeeTotal;
    }

    /**
     * @dev Updates the collateral (cToken held) and borrow position (underlying owed on Compound)
     */
    function _updateLeverPositions(ActionInfo memory actionInfo, IERC20 borrowAsset) internal {
        _updateCollateralPosition(
            actionInfo.matrixToken,
            actionInfo.collateralCTokenAsset,
            _getCollateralPosition(actionInfo.matrixToken, actionInfo.collateralCTokenAsset, actionInfo.matrixTotalSupply)
        );

        _updateBorrowPosition(
            actionInfo.matrixToken,
            borrowAsset,
            _getBorrowPosition(
                actionInfo.matrixToken,
                actionInfo.borrowCTokenAsset,
                actionInfo.matrixTotalSupply,
                false // Do not accrue interest
            )
        );
    }

    function _updateCollateralPosition(
        IMatrixToken matrixToken,
        ICErc20 cToken,
        uint256 newPositionUnit
    ) internal {
        matrixToken.editDefaultPosition(address(cToken), newPositionUnit);
    }

    function _updateBorrowPosition(
        IMatrixToken matrixToken,
        IERC20 underlyingToken,
        int256 newPositionUnit
    ) internal {
        matrixToken.editExternalPosition(address(underlyingToken), address(this), newPositionUnit, "");
    }

    /**
     * @dev Construct the ActionInfo struct for lever and delever
     */
    function _createAndValidateActionInfo(
        IMatrixToken matrixToken,
        IERC20 sendToken,
        IERC20 receiveToken,
        uint256 sendQuantityUnits,
        uint256 minReceiveQuantityUnits,
        string memory tradeAdapterName,
        bool isLever
    ) internal view returns (ActionInfo memory) {
        uint256 totalSupply = matrixToken.totalSupply();

        return
            _createAndValidateActionInfoNotional(
                matrixToken,
                sendToken,
                receiveToken,
                sendQuantityUnits.preciseMul(totalSupply),
                minReceiveQuantityUnits.preciseMul(totalSupply),
                tradeAdapterName,
                isLever
            );
    }

    /**
     * @dev Construct the ActionInfo struct for lever and delever accepting notional units
     */
    function _createAndValidateActionInfoNotional(
        IMatrixToken matrixToken,
        IERC20 sendToken,
        IERC20 receiveToken,
        uint256 notionalSendQuantity,
        uint256 minNotionalReceiveQuantity,
        string memory tradeAdapterName,
        bool isLever
    ) internal view returns (ActionInfo memory) {
        uint256 totalSupply = matrixToken.totalSupply();
        ActionInfo memory actionInfo = ActionInfo({
            exchangeAdapter: IExchangeAdapter(getAndValidateAdapter(tradeAdapterName)),
            matrixToken: matrixToken,
            collateralCTokenAsset: isLever ? _underlyingToCToken[receiveToken] : _underlyingToCToken[sendToken],
            borrowCTokenAsset: isLever ? _underlyingToCToken[sendToken] : _underlyingToCToken[receiveToken],
            matrixTotalSupply: totalSupply,
            notionalSendQuantity: notionalSendQuantity,
            minNotionalReceiveQuantity: minNotionalReceiveQuantity,
            preTradeReceiveTokenBalance: IERC20(receiveToken).balanceOf(address(matrixToken))
        });

        _validateCommon(actionInfo);

        return actionInfo;
    }

    function _validateCommon(ActionInfo memory actionInfo) internal view {
        require(_collateralCTokenEnabled[actionInfo.matrixToken][actionInfo.collateralCTokenAsset], "CL12a");
        require(_borrowCTokenEnabled[actionInfo.matrixToken][actionInfo.borrowCTokenAsset], "CL12b");
        require(actionInfo.collateralCTokenAsset != actionInfo.borrowCTokenAsset, "CL12c");
        require(actionInfo.notionalSendQuantity > 0, "CL12d");
    }

    function _getCollateralPosition(
        IMatrixToken matrixToken,
        ICErc20 cToken,
        uint256 matrixTotalSupply
    ) internal view returns (uint256) {
        uint256 collateralNotionalBalance = cToken.balanceOf(address(matrixToken));
        return collateralNotionalBalance.preciseDiv(matrixTotalSupply);
    }

    /**
     * @dev Get borrow position. If should accrue interest is true, then accrue interest on Compound
     * and use current borrow balance, else use the stored value to save gas. Use the current value
     * for debt redemption, when we need to calculate the exact units of debt that needs to be repaid.
     */
    function _getBorrowPosition(
        IMatrixToken matrixToken,
        ICErc20 cToken,
        uint256 matrixTotalSupply,
        bool shouldAccrueInterest
    ) internal returns (int256) {
        uint256 borrowNotionalBalance = shouldAccrueInterest
            ? cToken.borrowBalanceCurrent(address(matrixToken))
            : cToken.borrowBalanceStored(address(matrixToken));

        // Round negative away from 0
        int256 borrowPositionUnit = borrowNotionalBalance.preciseDivCeil(matrixTotalSupply).toInt256();

        return -borrowPositionUnit;
    }

    // ==================== Private functions ====================

    function _onlyAdmin() private view {
        require(hasRole(ADMIN_ROLE, _msgSender()), "CL13");
    }
}
