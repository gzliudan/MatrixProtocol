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

import { AaveV2 } from "../integration/lib/AaveV2.sol";

import { IAToken } from "../../interfaces/external/aave-v2/IAToken.sol";
import { ILendingPool } from "../../interfaces/external/aave-v2/ILendingPool.sol";
import { IProtocolDataProvider } from "../../interfaces/external/aave-v2/IProtocolDataProvider.sol";
import { ILendingPoolAddressesProvider } from "../../interfaces/external/aave-v2/ILendingPoolAddressesProvider.sol";

import { IController } from "../../interfaces/IController.sol";
import { IMatrixToken } from "../../interfaces/IMatrixToken.sol";
import { IExchangeAdapter } from "../../interfaces/IExchangeAdapter.sol";
import { IDebtIssuanceModule } from "../../interfaces/IDebtIssuanceModule.sol";
import { IModuleIssuanceHook } from "../../interfaces/IModuleIssuanceHook.sol";

/**
 * @title AaveLeverageModule
 *
 * @dev Smart contract that enables leverage trading using Aave as the lending protocol.
 *
 * @notice Do not use this module in conjunction with other debt modules that allow Aave debt positions
 * as it could lead to double counting of debt when borrowed assets are the same.
 */
contract AaveLeverageModule is ModuleBase, ReentrancyGuard, AccessControlEnumerable, IModuleIssuanceHook {
    using SafeCast for int256;
    using SafeCast for uint256;
    using SignedMath for int256;
    using PreciseUnitMath for int256;
    using PreciseUnitMath for uint256;
    using AddressArrayUtil for address[];
    using AaveV2 for IMatrixToken;
    using PositionUtil for IMatrixToken;

    // ==================== Constants ====================

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    // This module only supports borrowing in variable rate mode from Aave which is represented by 2
    uint256 internal constant BORROW_RATE_MODE = 2;

    // String identifying the DebtIssuanceModule in the IntegrationRegistry.
    // Note: Governance must add DefaultIssuanceModule as the string as the integration name
    string internal constant DEFAULT_ISSUANCE_MODULE_NAME = "DEFAULT_ISSUANCE_MODULE";

    // 0 index stores protocol fee % on the controller, charged in the _executeTrade function
    uint256 internal constant PROTOCOL_TRADE_FEE_INDEX = 0;

    // ==================== Structs ====================

    struct EnabledAssets {
        address[] collateralAssets; // Array of enabled underlying collateral assets for a MatrixToken
        address[] borrowAssets; // Array of enabled underlying borrow assets for a MatrixToken
    }

    struct ReserveTokens {
        IAToken aToken; // Reserve's aToken instance
        IERC20 variableDebtToken; // Reserve's variable debt token instance, IVariableDebtToken
    }

    struct ActionInfo {
        uint256 matrixTotalSupply; // Total supply of MatrixToken
        uint256 notionalSendQuantity; // Total notional quantity sent to exchange
        uint256 minNotionalReceiveQuantity; // Min total notional received from exchange
        uint256 preTradeReceiveTokenBalance; // Balance of pre-trade receive token balance
        IMatrixToken matrixToken; // MatrixToken instance
        ILendingPool lendingPool; // Lending pool instance, we grab this everytime since it's best practice not to store
        IExchangeAdapter exchangeAdapter; // Exchange adapter instance
        IERC20 collateralAsset; // Address of collateral asset
        IERC20 borrowAsset; // Address of borrow asset
    }

    // ==================== Variables ====================

    // Mapping to efficiently fetch reserve token addresses. Tracking Aave reserve token addresses
    // and updating them upon requirement is more efficient than fetching them each time from Aave.
    // Note: For an underlying asset to be enabled as collateral/borrow asset on MatrixToken, it must be added to this mapping first.
    mapping(IERC20 => ReserveTokens) internal _underlyingToReserveTokens;

    // Used to fetch reserves and user data from AaveV2
    IProtocolDataProvider internal immutable _protocolDataProvider;

    // Used to fetch lendingPool address. This contract is immutable and its address will never change.
    ILendingPoolAddressesProvider internal immutable _lendingPoolAddressesProvider;

    // Mapping to efficiently check if collateral asset is enabled in MatrixToken
    mapping(IMatrixToken => mapping(IERC20 => bool)) internal _isEnabledCollateralAsset;

    // Mapping to efficiently check if a borrow asset is enabled in MatrixToken
    mapping(IMatrixToken => mapping(IERC20 => bool)) internal _isEnabledBorrowAsset;

    // Internal mapping of enabled collateral and borrow tokens for syncing positions
    mapping(IMatrixToken => EnabledAssets) internal _enabledAssets;

    // Mapping of MatrixToken to boolean indicating if MatrixToken is on allow list. Updateable by governance
    mapping(IMatrixToken => bool) internal _isAllowedMatrixTokens;

    // Boolean that returns if any MatrixToken can initialize this module. If false, then subject to allow list. Updateable by governance.
    bool internal _isAnyMatrixAllowed;

    // ==================== Events ====================

    /**
     * @param matrixToken           Instance of the MatrixToken being levered
     * @param borrowAsset           Asset being borrowed for leverage
     * @param collateralAsset       Collateral asset being levered
     * @param exchangeAdapter       Exchange adapter used for trading
     * @param totalBorrowAmount     Total amount of `borrowAsset` borrowed
     * @param totalReceiveAmount    Total amount of `collateralAsset` received by selling `borrowAsset`
     * @param protocolFee           Protocol fee charged
     */
    event IncreaseLeverage(
        IMatrixToken indexed matrixToken,
        IERC20 indexed borrowAsset,
        IERC20 indexed collateralAsset,
        IExchangeAdapter exchangeAdapter,
        uint256 totalBorrowAmount,
        uint256 totalReceiveAmount,
        uint256 protocolFee
    );

    /**
     * @param matrixToken          Instance of the MatrixToken being delevered
     * @param collateralAsset      Asset sold to decrease leverage
     * @param repayAsset           Asset being bought to repay to Aave
     * @param exchangeAdapter      Exchange adapter used for trading
     * @param totalRedeemAmount    Total amount of `collateralAsset` being sold
     * @param totalRepayAmount     Total amount of `repayAsset` being repaid
     * @param protocolFee          Protocol fee charged
     */
    event DecreaseLeverage(
        IMatrixToken indexed matrixToken,
        IERC20 indexed collateralAsset,
        IERC20 indexed repayAsset,
        IExchangeAdapter exchangeAdapter,
        uint256 totalRedeemAmount,
        uint256 totalRepayAmount,
        uint256 protocolFee
    );

    /**
     * @param matrixToken    Instance of MatrixToken whose collateral assets is updated
     * @param added          true if assets are added false if removed
     * @param assets         Array of collateral assets being added/removed
     */
    event UpdateCollateralAssets(IMatrixToken indexed matrixToken, bool indexed added, IERC20[] assets);

    /**
     * @param matrixToken    Instance of MatrixToken whose borrow assets is updated
     * @param added          true if assets are added false if removed
     * @param assets         Array of borrow assets being added/removed
     */
    event UpdateBorrowAssets(IMatrixToken indexed matrixToken, bool indexed added, IERC20[] assets);

    /**
     * @param underlying           Address of the underlying asset
     * @param aToken               Updated aave reserve aToken
     * @param variableDebtToken    Updated aave reserve variable debt token
     */
    event UpdateReserveTokens(IERC20 indexed underlying, IAToken indexed aToken, IERC20 indexed variableDebtToken);

    /**
     * @param matrixToken    MatrixToken being whose allowance to initialize this module is being updated
     * @param added          true if added; false if removed
     */
    event UpdateMatrixTokenStatus(IMatrixToken indexed matrixToken, bool indexed added);

    /**
     * @param anyMatrixAllowed    true if any set is allowed to initialize this module, false otherwise
     */
    event UpdateAnyMatrixAllowed(bool indexed anyMatrixAllowed);

    // ==================== Constructor function ====================

    constructor(IController controller, ILendingPoolAddressesProvider lendingPoolAddressesProvider) ModuleBase(controller) {
        _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _grantRole(ADMIN_ROLE, _msgSender());

        _lendingPoolAddressesProvider = lendingPoolAddressesProvider;

        // Each market has a separate Protocol Data Provider. To get the address for a particular market, call getAddress() using the value 0x01.
        // Use the raw input vs bytes32() conversion. This is to ensure the input is an uint and not a string.
        bytes32 value01 = 0x0100000000000000000000000000000000000000000000000000000000000000;
        IProtocolDataProvider protocolDataProvider = IProtocolDataProvider(lendingPoolAddressesProvider.getAddress(value01));

        _protocolDataProvider = protocolDataProvider;
        IProtocolDataProvider.TokenData[] memory reserveTokens = protocolDataProvider.getAllReservesTokens();
        for (uint256 i = 0; i < reserveTokens.length; i++) {
            (address aToken, , address variableDebtToken) = protocolDataProvider.getReserveTokensAddresses(reserveTokens[i].tokenAddress);
            _underlyingToReserveTokens[IERC20(reserveTokens[i].tokenAddress)] = ReserveTokens({
                aToken: IAToken(aToken),
                variableDebtToken: IERC20(variableDebtToken)
            });
        }
    }

    // ==================== Modifier functions ====================

    modifier onlyAdmin() {
        _onlyAdmin();
        _;
    }

    // ==================== External functions ====================

    function getUnderlyingToReserveTokens(IERC20 asset) external view returns (ReserveTokens memory) {
        return _underlyingToReserveTokens[asset];
    }

    function getProtocolDataProvider() external view returns (IProtocolDataProvider) {
        return _protocolDataProvider;
    }

    function getLendingPoolAddressesProvider() external view returns (ILendingPoolAddressesProvider) {
        return _lendingPoolAddressesProvider;
    }

    function isEnabledCollateralAsset(IMatrixToken matrixToken, IERC20 asset) external view returns (bool) {
        return _isEnabledCollateralAsset[matrixToken][asset];
    }

    function isEnabledBorrowAsset(IMatrixToken matrixToken, IERC20 asset) external view returns (bool) {
        return _isEnabledBorrowAsset[matrixToken][asset];
    }

    function getEnabledAssets(IMatrixToken matrixToken) external view returns (address[] memory collateralAssets, address[] memory borrowAssets) {
        EnabledAssets storage enabledAssets = _enabledAssets[matrixToken];
        collateralAssets = enabledAssets.collateralAssets;
        borrowAssets = enabledAssets.borrowAssets;
    }

    function isAllowedMatrixToken(IMatrixToken matrixToken) external view returns (bool) {
        return _isAllowedMatrixTokens[matrixToken];
    }

    function isAnyMatrixAllowed() external view returns (bool) {
        return _isAnyMatrixAllowed;
    }

    /**
     * @dev MANAGER ONLY: Increases leverage for a given collateral position using an enabled borrow asset. Borrows borrowAsset from Aave.
     * Performs a DEX trade, exchanging the borrowAsset for collateralAsset. Deposits collateralAsset to Aave and mints corresponding aToken.
     * @notice Both collateral and borrow assets need to be enabled, and they must not be the same asset.
     *
     * @param matrixToken                Instance of the MatrixToken
     * @param borrowAsset                Address of underlying asset being borrowed for leverage
     * @param collateralAsset            Address of underlying collateral asset
     * @param borrowQuantityUnits        Borrow quantity of asset in position units
     * @param minReceiveQuantityUnits    Min receive quantity of collateral asset to receive post-trade in position units
     * @param tradeAdapterName           Name of trade adapter
     * @param tradeData                  Arbitrary data for trade
     */
    function lever(
        IMatrixToken matrixToken,
        IERC20 borrowAsset,
        IERC20 collateralAsset,
        uint256 borrowQuantityUnits,
        uint256 minReceiveQuantityUnits,
        string memory tradeAdapterName,
        bytes memory tradeData
    ) external nonReentrant onlyManagerAndValidMatrix(matrixToken) {
        ActionInfo memory leverInfo = _createAndValidateActionInfo(
            matrixToken,
            borrowAsset, // sendToken
            collateralAsset, // receiveToken
            borrowQuantityUnits, // sendQuantityUnits
            minReceiveQuantityUnits, // minReceiveQuantityUnits
            tradeAdapterName,
            true // isLever
        );

        _borrow(leverInfo.matrixToken, leverInfo.lendingPool, leverInfo.borrowAsset, leverInfo.notionalSendQuantity);
        uint256 postTradeReceiveQuantity = _executeTrade(leverInfo, borrowAsset, collateralAsset, tradeData);
        uint256 protocolFee = _accrueProtocolFee(matrixToken, collateralAsset, postTradeReceiveQuantity);
        uint256 postTradeCollateralQuantity = postTradeReceiveQuantity - protocolFee;
        _deposit(leverInfo.matrixToken, leverInfo.lendingPool, collateralAsset, postTradeCollateralQuantity);
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
     * @dev MANAGER ONLY: Decrease leverage for a given collateral position using an enabled borrow asset. Withdraws collateralAsset from Aave.
     * Performs a DEX trade, exchanging the collateralAsset for repayAsset. Repays repayAsset to Aave and burns corresponding debt tokens.
     * @notice Both collateral and borrow assets need to be enabled, and they must not be the same asset.
     *
     * @param matrixToken              Instance of the MatrixToken
     * @param collateralAsset          Address of underlying collateral asset being withdrawn
     * @param repayAsset               Address of underlying borrowed asset being repaid
     * @param redeemQuantityUnits      Quantity of collateral asset to delever in position units
     * @param minRepayQuantityUnits    Minimum amount of repay asset to receive post trade in position units
     * @param tradeAdapterName         Name of trade adapter
     * @param tradeData                Arbitrary data for trade
     */
    function delever(
        IMatrixToken matrixToken,
        IERC20 collateralAsset,
        IERC20 repayAsset,
        uint256 redeemQuantityUnits,
        uint256 minRepayQuantityUnits,
        string memory tradeAdapterName,
        bytes memory tradeData
    ) external nonReentrant onlyManagerAndValidMatrix(matrixToken) {
        ActionInfo memory deleverInfo = _createAndValidateActionInfo(
            matrixToken,
            collateralAsset, // sendToken
            repayAsset, // receiveToken
            redeemQuantityUnits, // sendQuantityUnits
            minRepayQuantityUnits, // minReceiveQuantityUnits
            tradeAdapterName,
            false // isLever
        );

        _withdraw(deleverInfo.matrixToken, deleverInfo.lendingPool, collateralAsset, deleverInfo.notionalSendQuantity);
        uint256 postTradeReceiveQuantity = _executeTrade(deleverInfo, collateralAsset, repayAsset, tradeData);
        uint256 protocolFee = _accrueProtocolFee(matrixToken, repayAsset, postTradeReceiveQuantity);
        uint256 repayQuantity = postTradeReceiveQuantity - protocolFee;
        _repayBorrow(deleverInfo.matrixToken, deleverInfo.lendingPool, repayAsset, repayQuantity);
        _updateDeleverPositions(deleverInfo, repayAsset);

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

    /** @dev MANAGER ONLY: Pays down the borrow asset to 0 selling off a given amount of collateral asset. Withdraws collateralAsset from Aave. Performs a DEX trade,
     * exchanging the collateralAsset for repayAsset. Minimum receive amount for the DEX trade is set to the current variable debt balance of the borrow asset.
     * Repays received repayAsset to Aave which burns corresponding debt tokens. Any extra received borrow asset is updated as equity. No protocol fee is charged.
     * @notice Both collateral and borrow assets need to be enabled, and they must not be the same asset.
     * The function reverts if not enough collateral asset is redeemed to buy the required minimum amount of repayAsset.
     *
     * @param matrixToken            Instance of the MatrixToken
     * @param collateralAsset        Address of underlying collateral asset being redeemed
     * @param repayAsset             Address of underlying asset being repaid
     * @param redeemQuantityUnits    Quantity of collateral asset to delever in position units
     * @param tradeAdapterName       Name of trade adapter
     * @param tradeData              Arbitrary data for trade
     *
     * @return uint256               Notional repay quantity
     */
    function deleverToZeroBorrowBalance(
        IMatrixToken matrixToken,
        IERC20 collateralAsset,
        IERC20 repayAsset,
        uint256 redeemQuantityUnits,
        string memory tradeAdapterName,
        bytes memory tradeData
    ) external nonReentrant onlyManagerAndValidMatrix(matrixToken) returns (uint256) {
        require(_isEnabledBorrowAsset[matrixToken][repayAsset], "L0a"); // "Borrow not enabled"

        uint256 notionalRepayQuantity = _underlyingToReserveTokens[repayAsset].variableDebtToken.balanceOf(address(matrixToken));
        require(notionalRepayQuantity > 0, "L0b"); // "Borrow balance is zero"

        uint256 matrixTotalSupply = matrixToken.totalSupply();
        uint256 notionalRedeemQuantity = redeemQuantityUnits.preciseMul(matrixTotalSupply);
        ActionInfo memory deleverInfo = _createAndValidateActionInfoNotional(
            matrixToken,
            collateralAsset, // sendToken
            repayAsset, // receiveToken
            notionalRedeemQuantity, // notionalSendQuantity
            notionalRepayQuantity, // minNotionalReceiveQuantity
            tradeAdapterName,
            false, // isLever
            matrixTotalSupply // matrixTotalSupply
        );

        _withdraw(deleverInfo.matrixToken, deleverInfo.lendingPool, collateralAsset, deleverInfo.notionalSendQuantity);
        _executeTrade(deleverInfo, collateralAsset, repayAsset, tradeData);
        _repayBorrow(deleverInfo.matrixToken, deleverInfo.lendingPool, repayAsset, notionalRepayQuantity);
        _updateDeleverPositions(deleverInfo, repayAsset);

        emit DecreaseLeverage(
            matrixToken,
            collateralAsset,
            repayAsset,
            deleverInfo.exchangeAdapter,
            deleverInfo.notionalSendQuantity,
            notionalRepayQuantity,
            0
        );

        return notionalRepayQuantity;
    }

    /**
     * @dev MANAGER ONLY: Initializes this module to the MatrixToken. Either the MatrixToken needs to be
     * on the allowed list or anyMatrixAllowed needs to be true. Only callable by the MatrixToken's manager.
     * @notice Managers can enable collateral and borrow assets that don't exist as positions on the MatrixToken
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
        require(_isAnyMatrixAllowed || _isAllowedMatrixTokens[matrixToken], "L1a"); // "Not allowed MatrixToken"

        // Initialize module before trying register
        matrixToken.initializeModule();

        // Get debt issuance module registered to this module and require that it is initialized
        require(matrixToken.isInitializedModule(getAndValidateAdapter(DEFAULT_ISSUANCE_MODULE_NAME)), "L1b"); // "Issuance not initialized"

        // Try if register exists on any of the modules including the debt issuance module
        address[] memory modules = matrixToken.getModules();
        for (uint256 i = 0; i < modules.length; i++) {
            try IDebtIssuanceModule(modules[i]).registerToIssuanceModule(matrixToken) {} catch {}
        }

        // collateralAssets and borrowAssets arrays are validated in their respective internal functions
        _addCollateralAssets(matrixToken, collateralAssets);
        _addBorrowAssets(matrixToken, borrowAssets);
    }

    /**
     * @dev MANAGER ONLY: Removes this module from the MatrixToken, via call by the MatrixToken. Any deposited collateral
     * assets are disabled to be used as collateral on Aave. Aave Settings and manager enabled assets state is deleted.
     * @notice Function will revert is there is any debt remaining on Aave
     */
    function removeModule() external override onlyValidAndInitializedMatrix(IMatrixToken(msg.sender)) {
        IMatrixToken matrixToken = IMatrixToken(msg.sender);

        // Sync Aave and MatrixToken positions prior to any removal action
        sync(matrixToken);

        address[] storage borrowAssets = _enabledAssets[matrixToken].borrowAssets;
        for (uint256 i = 0; i < borrowAssets.length; i++) {
            IERC20 borrowAsset = IERC20(borrowAssets[i]);
            require(_underlyingToReserveTokens[borrowAsset].variableDebtToken.balanceOf(address(matrixToken)) == 0, "L2"); // "Variable debt remaining"

            delete _isEnabledBorrowAsset[matrixToken][borrowAsset];
        }

        address[] storage collateralAssets = _enabledAssets[matrixToken].collateralAssets;
        for (uint256 i = 0; i < collateralAssets.length; i++) {
            IERC20 collateralAsset = IERC20(collateralAssets[i]);
            _updateUseReserveAsCollateral(matrixToken, collateralAsset, false);

            delete _isEnabledCollateralAsset[matrixToken][collateralAsset];
        }

        delete _enabledAssets[matrixToken];

        // Try if unregister exists on any of the modules
        address[] memory modules = matrixToken.getModules();
        for (uint256 i = 0; i < modules.length; i++) {
            try IDebtIssuanceModule(modules[i]).unregisterFromIssuanceModule(matrixToken) {} catch {}
        }
    }

    /**
     * @dev MANAGER ONLY: Add registration of this module on the debt issuance module for the MatrixToken.
     * @notice if the debt issuance module is not added to MatrixToken before this module is initialized, then this function
     * needs to be called if the debt issuance module is later added and initialized to prevent state inconsistencies
     * @param matrixToken           Instance of the MatrixToken
     * @param debtIssuanceModule    Debt issuance module address to register
     */
    function registerToModule(IMatrixToken matrixToken, IDebtIssuanceModule debtIssuanceModule) external onlyManagerAndValidMatrix(matrixToken) {
        require(matrixToken.isInitializedModule(address(debtIssuanceModule)), "L3"); // "Issuance not initialized"

        debtIssuanceModule.registerToIssuanceModule(matrixToken);
    }

    /**
     * @dev CALLABLE BY ANYBODY: Updates `_underlyingToReserveTokens` mappings.
     * Revert if mapping already exists or the passed underlying asset does not have a valid reserve on Aave.
     * @notice Call this function when Aave adds a new reserve.
     *
     * @param underlying    Address of underlying asset
     */
    function addUnderlyingToReserveTokensMapping(IERC20 underlying) external {
        require(address(_underlyingToReserveTokens[underlying].aToken) == address(0), "L4a"); // "Mapping already exists"

        // An active reserve is an alias for a valid reserve on Aave.
        (, , , , , , , , bool isActive, ) = _protocolDataProvider.getReserveConfigurationData(address(underlying));

        require(isActive, "L4b"); // "Invalid aave reserve"

        _addUnderlyingToReserveTokensMapping(underlying);
    }

    /**
     * @dev MANAGER ONLY: Add collateral assets. aTokens corresponding to collateral assets are tracked for syncing positions.
     * Revert if there are duplicate assets in the passed newCollateralAssets array.
     *
     * @notice All added collateral assets can be added as a position on the MatrixToken without manager's explicit permission.
     * Unwanted extra positions can break external logic, increase cost of mint/redeem of MatrixToken, among other potential unintended consequences.
     * So, please add only those collateral assets whose corresponding atokens are needed as default positions on THE MatrixToken.
     *
     * @param matrixToken            Instance of the MatrixToken
     * @param newCollateralAssets    Addresses of new collateral underlying assets
     */
    function addCollateralAssets(IMatrixToken matrixToken, IERC20[] memory newCollateralAssets) external onlyManagerAndValidMatrix(matrixToken) {
        _addCollateralAssets(matrixToken, newCollateralAssets);
    }

    /**
     * @dev MANAGER ONLY: Remove collateral assets. Disable deposited assets to be used as collateral on Aave market.
     *
     * @param matrixToken         Instance of the MatrixToken
     * @param collateralAssets    Addresses of collateral underlying assets to remove
     */
    function removeCollateralAssets(IMatrixToken matrixToken, IERC20[] memory collateralAssets) external onlyManagerAndValidMatrix(matrixToken) {
        for (uint256 i = 0; i < collateralAssets.length; i++) {
            IERC20 collateralAsset = collateralAssets[i];
            require(_isEnabledCollateralAsset[matrixToken][collateralAsset], "L5"); // "Collateral not enabled"

            _updateUseReserveAsCollateral(matrixToken, collateralAsset, false);
            delete _isEnabledCollateralAsset[matrixToken][collateralAsset];
            _enabledAssets[matrixToken].collateralAssets.quickRemoveItem(address(collateralAsset));
        }

        emit UpdateCollateralAssets(matrixToken, false, collateralAssets);
    }

    /**
     * @dev MANAGER ONLY: Add borrow assets. Debt tokens corresponding to borrow assets are tracked for syncing positions.
     * @notice Revert if there are duplicate assets in the passed newBorrowAssets array.
     *
     * @param matrixToken        Instance of the MatrixToken
     * @param newBorrowAssets    Addresses of borrow underlying assets to add
     */
    function addBorrowAssets(IMatrixToken matrixToken, IERC20[] memory newBorrowAssets) external onlyManagerAndValidMatrix(matrixToken) {
        _addBorrowAssets(matrixToken, newBorrowAssets);
    }

    /**
     * @dev MANAGER ONLY: Remove borrow assets.
     * @notice If there is a borrow balance, borrow asset cannot be removed
     *
     * @param matrixToken     Instance of the MatrixToken
     * @param borrowAssets    Addresses of borrow underlying assets to remove
     */
    function removeBorrowAssets(IMatrixToken matrixToken, IERC20[] memory borrowAssets) external onlyManagerAndValidMatrix(matrixToken) {
        for (uint256 i = 0; i < borrowAssets.length; i++) {
            IERC20 borrowAsset = borrowAssets[i];
            require(_isEnabledBorrowAsset[matrixToken][borrowAsset], "L6a"); // "Borrow not enabled"
            require(_underlyingToReserveTokens[borrowAsset].variableDebtToken.balanceOf(address(matrixToken)) == 0, "L6b"); // "Variable debt remaining"

            delete _isEnabledBorrowAsset[matrixToken][borrowAsset];
            _enabledAssets[matrixToken].borrowAssets.quickRemoveItem(address(borrowAsset));
        }

        emit UpdateBorrowAssets(matrixToken, false, borrowAssets);
    }

    /**
     * @dev GOVERNANCE ONLY: Enable/disable ability of a MatrixToken to initialize this module. Only callable by governance.
     *
     * @param matrixToken    Instance of the MatrixToken
     * @param status         Bool indicating if matrixToken is allowed to initialize this module
     */
    function updateAllowedMatrixToken(IMatrixToken matrixToken, bool status) external onlyAdmin {
        require(_controller.isMatrix(address(matrixToken)) || _isAllowedMatrixTokens[matrixToken], "L7"); // "Invalid MatrixToken"

        _isAllowedMatrixTokens[matrixToken] = status;

        emit UpdateMatrixTokenStatus(matrixToken, status);
    }

    /**
     * @dev GOVERNANCE ONLY: Toggle whether ANY MatrixToken is allowed to initialize this module. Only callable by governance.
     *
     * @param anyMatrixAllowed    Bool indicating if ANY MatrixToken is allowed to initialize this module
     */
    function updateAnyMatrixAllowed(bool anyMatrixAllowed) external onlyAdmin {
        _isAnyMatrixAllowed = anyMatrixAllowed;

        emit UpdateAnyMatrixAllowed(anyMatrixAllowed);
    }

    /**
     * @dev MODULE ONLY: Hook called prior to issuance to sync positions on MatrixToken. Only callable by valid module.
     *
     * @param matrixToken    Instance of the MatrixToken
     */
    function moduleIssueHook(
        IMatrixToken matrixToken,
        uint256 /* matrixTokenQuantity */
    ) external override onlyModule(matrixToken) {
        sync(matrixToken);
    }

    /**
     * @dev MODULE ONLY: Hook called prior to redemption to sync positions on MatrixToken.
     * For redemption, always use current borrowed balance after interest accrual. Only callable by valid module.
     *
     * @param matrixToken             Instance of the MatrixToken
     */
    function moduleRedeemHook(
        IMatrixToken matrixToken,
        uint256 /* matrixTokenQuantity */
    ) external override onlyModule(matrixToken) {
        sync(matrixToken);
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
        bool isEquity
    ) external override onlyModule(matrixToken) {
        // Check hook not being called for an equity position. If hook is called with equity position and
        // outstanding borrow position exists the loan would be taken out twice potentially leading to liquidation
        if (!isEquity) {
            int256 componentDebt = matrixToken.getExternalPositionRealUnit(address(component), address(this));

            require(componentDebt < 0, "L8"); // "Component must be negative"

            uint256 notionalDebt = componentDebt.abs().preciseMul(matrixTokenQuantity);
            _borrowForHook(matrixToken, component, notionalDebt);
        }
    }

    /**
     * @dev MODULE ONLY: Hook called prior to looping through each component on redemption.
     * Invokes repay after the issuance module transfers debt from the issuer. Only callable by valid module.
     *
     * @param matrixToken            Instance of the MatrixToken
     * @param matrixTokenQuantity    Quantity of MatrixToken
     * @param component              Address of component
     */
    function componentRedeemHook(
        IMatrixToken matrixToken,
        uint256 matrixTokenQuantity,
        IERC20 component,
        bool isEquity
    ) external override onlyModule(matrixToken) {
        // Check hook not being called for an equity position. If hook is called with equity position and
        // outstanding borrow position exists the loan would be paid down twice, decollateralizing the Matrix
        if (!isEquity) {
            int256 componentDebt = matrixToken.getExternalPositionRealUnit(address(component), address(this));

            require(componentDebt < 0, "L9"); // "Component must be negative"

            uint256 notionalDebt = componentDebt.abs().preciseMulCeil(matrixTokenQuantity);
            _repayBorrowForHook(matrixToken, component, notionalDebt);
        }
    }

    // ==================== Public functions ====================

    /**
     * @dev CALLABLE BY ANYBODY: Sync Matrix positions with ALL enabled Aave collateral and borrow positions.
     * For collateral assets, update aToken default position. For borrow assets, update external borrow position.
     * Collateral assets may come out of sync when interest is accrued or a position is liquidated.
     * Borrow assets may come out of sync when interest is accrued or position is liquidated and borrow is repaid.
     *
     * @notice In Aave, both collateral and borrow interest is accrued in each block by increasing the balance of
     * aTokens and debtTokens for each user, and 1 aToken = 1 variableDebtToken = 1 underlying.
     *
     * @param matrixToken    Instance of the MatrixToken
     */
    function sync(IMatrixToken matrixToken) public nonReentrant onlyValidAndInitializedMatrix(matrixToken) {
        uint256 matrixTotalSupply = matrixToken.totalSupply();

        // Only sync positions when Matrix supply is not 0. Without this check, if sync is called by someone before
        // the first issuance, then editDefaultPosition would remove the default positions from the MatrixToken
        if (matrixTotalSupply > 0) {
            address[] storage collateralAssets = _enabledAssets[matrixToken].collateralAssets;
            for (uint256 i = 0; i < collateralAssets.length; i++) {
                IAToken aToken = _underlyingToReserveTokens[IERC20(collateralAssets[i])].aToken;
                uint256 previousPositionUnit = matrixToken.getDefaultPositionRealUnit(address(aToken)).toUint256();
                uint256 newPositionUnit = _getCollateralPosition(matrixToken, aToken, matrixTotalSupply);

                // Note: Accounts for if position does not exist on MatrixToken but is tracked in _enabledAssets
                if (previousPositionUnit != newPositionUnit) {
                    _updateCollateralPosition(matrixToken, aToken, newPositionUnit);
                }
            }

            address[] storage borrowAssets = _enabledAssets[matrixToken].borrowAssets;
            for (uint256 i = 0; i < borrowAssets.length; i++) {
                IERC20 borrowAsset = IERC20(borrowAssets[i]);
                int256 previousPositionUnit = matrixToken.getExternalPositionRealUnit(address(borrowAsset), address(this));
                int256 newPositionUnit = _getBorrowPosition(matrixToken, borrowAsset, matrixTotalSupply);

                // Note: Accounts for if position does not exist on MatrixToken but is tracked in _enabledAssets
                if (newPositionUnit != previousPositionUnit) {
                    _updateBorrowPosition(matrixToken, borrowAsset, newPositionUnit);
                }
            }
        }
    }

    // ==================== Internal functions ====================

    /**
     * @dev Invoke deposit from MatrixToken using AaveV2 library. Mints aTokens for MatrixToken.
     */
    function _deposit(
        IMatrixToken matrixToken,
        ILendingPool lendingPool,
        IERC20 asset,
        uint256 notionalQuantity
    ) internal {
        matrixToken.invokeSafeIncreaseAllowance(address(asset), address(lendingPool), notionalQuantity);
        matrixToken.invokeDeposit(lendingPool, address(asset), notionalQuantity);
    }

    /**
     * @dev Invoke withdraw from MatrixToken using AaveV2 library. Burns aTokens and returns underlying to MatrixToken.
     */
    function _withdraw(
        IMatrixToken matrixToken,
        ILendingPool lendingPool,
        IERC20 asset,
        uint256 notionalQuantity
    ) internal {
        matrixToken.invokeWithdraw(lendingPool, address(asset), notionalQuantity);
    }

    /**
     * @dev Invoke repay from MatrixToken using AaveV2 library. Burns DebtTokens for MatrixToken.
     */
    function _repayBorrow(
        IMatrixToken matrixToken,
        ILendingPool lendingPool,
        IERC20 asset,
        uint256 notionalQuantity
    ) internal {
        matrixToken.invokeSafeIncreaseAllowance(address(asset), address(lendingPool), notionalQuantity);
        matrixToken.invokeRepay(lendingPool, address(asset), notionalQuantity, BORROW_RATE_MODE);
    }

    /**
     * @dev Invoke borrow from the MatrixToken during issuance hook. Since we only need to interact with AAVE once we fetch the
     * lending pool in this function to optimize vs forcing a fetch twice during lever/delever.
     */
    function _repayBorrowForHook(
        IMatrixToken matrixToken,
        IERC20 asset,
        uint256 notionalQuantity
    ) internal {
        _repayBorrow(matrixToken, ILendingPool(_lendingPoolAddressesProvider.getLendingPool()), asset, notionalQuantity);
    }

    /**
     * @dev Invoke borrow from the MatrixToken using AaveV2 library. Mints DebtTokens for MatrixToken.
     */
    function _borrow(
        IMatrixToken matrixToken,
        ILendingPool lendingPool,
        IERC20 asset,
        uint256 notionalQuantity
    ) internal {
        matrixToken.invokeBorrow(lendingPool, address(asset), notionalQuantity, BORROW_RATE_MODE);
    }

    /**
     * @dev Invoke borrow from the MatrixToken during issuance hook. Since we only need to interact with AAVE
     * once we fetch the lending pool in this function to optimize vs forcing a fetch twice during lever/delever.
     */
    function _borrowForHook(
        IMatrixToken matrixToken,
        IERC20 asset,
        uint256 notionalQuantity
    ) internal {
        _borrow(matrixToken, ILendingPool(_lendingPoolAddressesProvider.getLendingPool()), asset, notionalQuantity);
    }

    /**
     * @dev Invokes approvals, gets trade call data from exchange adapter and invokes trade from MatrixToken.
     *
     * @return uint256    The quantity of tokens received post-trade
     */
    function _executeTrade(
        ActionInfo memory actionInfo,
        IERC20 sendToken,
        IERC20 receiveToken,
        bytes memory data
    ) internal returns (uint256) {
        IMatrixToken matrixToken = actionInfo.matrixToken;
        uint256 notionalSendQuantity = actionInfo.notionalSendQuantity;
        matrixToken.invokeSafeIncreaseAllowance(address(sendToken), actionInfo.exchangeAdapter.getSpender(), notionalSendQuantity);

        (address targetExchange, uint256 callValue, bytes memory methodData) = actionInfo.exchangeAdapter.getTradeCalldata(
            address(sendToken),
            address(receiveToken),
            address(matrixToken),
            notionalSendQuantity,
            actionInfo.minNotionalReceiveQuantity,
            data
        );

        matrixToken.invoke(targetExchange, callValue, methodData);
        uint256 receiveTokenQuantity = receiveToken.balanceOf(address(matrixToken)) - actionInfo.preTradeReceiveTokenBalance;

        require(receiveTokenQuantity >= actionInfo.minNotionalReceiveQuantity, "L10"); // "Slippage too high"

        return receiveTokenQuantity;
    }

    /**
     * @dev Calculates protocol fee on module and pays protocol fee from MatrixToken
     *
     * @return uint256    Total protocol fee paid
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
     * @dev Updates the collateral (aToken held) and borrow position (variableDebtToken held) of the MatrixToken
     */
    function _updateLeverPositions(ActionInfo memory actionInfo, IERC20 borrowAsset) internal {
        IAToken aToken = _underlyingToReserveTokens[actionInfo.collateralAsset].aToken;
        _updateCollateralPosition(actionInfo.matrixToken, aToken, _getCollateralPosition(actionInfo.matrixToken, aToken, actionInfo.matrixTotalSupply));
        _updateBorrowPosition(actionInfo.matrixToken, borrowAsset, _getBorrowPosition(actionInfo.matrixToken, borrowAsset, actionInfo.matrixTotalSupply));
    }

    /**
     * @dev Updates positions as per _updateLeverPositions and updates Default position for borrow asset in case
     * MatrixToken is delevered all the way to zero any remaining borrow asset after the debt is paid can be added as a position.
     */
    function _updateDeleverPositions(ActionInfo memory actionInfo, IERC20 repayAsset) internal {
        // if amount of tokens traded for exceeds debt, update default position first to save gas on editing borrow position
        uint256 repayAssetBalance = repayAsset.balanceOf(address(actionInfo.matrixToken));

        if (repayAssetBalance != actionInfo.preTradeReceiveTokenBalance) {
            actionInfo.matrixToken.calculateAndEditDefaultPosition(address(repayAsset), actionInfo.matrixTotalSupply, actionInfo.preTradeReceiveTokenBalance);
        }

        _updateLeverPositions(actionInfo, repayAsset);
    }

    /**
     * @dev Updates default position unit for given aToken on MatrixToken
     */
    function _updateCollateralPosition(
        IMatrixToken matrixToken,
        IAToken aToken,
        uint256 newPositionUnit
    ) internal {
        matrixToken.editDefaultPosition(address(aToken), newPositionUnit);
    }

    /**
     * @dev Updates external position unit for given borrow asset on MatrixToken
     */
    function _updateBorrowPosition(
        IMatrixToken matrixToken,
        IERC20 underlyingAsset,
        int256 newPositionUnit
    ) internal {
        matrixToken.editExternalPosition(address(underlyingAsset), address(this), newPositionUnit, "");
    }

    /**
     * @dev Construct the ActionInfo struct for lever and delever
     *
     * @return ActionInfo    Instance of constructed ActionInfo struct
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
                isLever,
                totalSupply
            );
    }

    /**
     * @dev Construct the ActionInfo struct for lever and delever accepting notional units
     *
     * @return ActionInfo    Instance of constructed ActionInfo struct
     */
    function _createAndValidateActionInfoNotional(
        IMatrixToken matrixToken,
        IERC20 sendToken,
        IERC20 receiveToken,
        uint256 notionalSendQuantity,
        uint256 minNotionalReceiveQuantity,
        string memory tradeAdapterName,
        bool isLever,
        uint256 matrixTotalSupply
    ) internal view returns (ActionInfo memory) {
        ActionInfo memory actionInfo = ActionInfo({
            exchangeAdapter: IExchangeAdapter(getAndValidateAdapter(tradeAdapterName)),
            lendingPool: ILendingPool(_lendingPoolAddressesProvider.getLendingPool()),
            matrixToken: matrixToken,
            collateralAsset: isLever ? receiveToken : sendToken,
            borrowAsset: isLever ? sendToken : receiveToken,
            matrixTotalSupply: matrixTotalSupply,
            notionalSendQuantity: notionalSendQuantity,
            minNotionalReceiveQuantity: minNotionalReceiveQuantity,
            preTradeReceiveTokenBalance: IERC20(receiveToken).balanceOf(address(matrixToken))
        });

        _validateCommon(actionInfo);

        return actionInfo;
    }

    /**
     * @dev Updates `_underlyingToReserveTokens` mappings for given `underlying` asset. Emits UpdateReserveTokens event.
     */
    function _addUnderlyingToReserveTokensMapping(IERC20 underlying) internal {
        (address aToken, , address variableDebtToken) = _protocolDataProvider.getReserveTokensAddresses(address(underlying));
        _underlyingToReserveTokens[underlying].aToken = IAToken(aToken);
        _underlyingToReserveTokens[underlying].variableDebtToken = IERC20(variableDebtToken);

        emit UpdateReserveTokens(underlying, IAToken(aToken), IERC20(variableDebtToken));
    }

    /**
     * @dev Add collateral assets to MatrixToken. Updates the collateralAssetsEnabled and _enabledAssets mappings. Emits UpdateCollateralAssets event.
     */
    function _addCollateralAssets(IMatrixToken matrixToken, IERC20[] memory newCollateralAssets) internal {
        for (uint256 i = 0; i < newCollateralAssets.length; i++) {
            IERC20 collateralAsset = newCollateralAssets[i];
            _validateNewCollateralAsset(matrixToken, collateralAsset);
            _updateUseReserveAsCollateral(matrixToken, collateralAsset, true);
            _isEnabledCollateralAsset[matrixToken][collateralAsset] = true;
            _enabledAssets[matrixToken].collateralAssets.push(address(collateralAsset));
        }

        emit UpdateCollateralAssets(matrixToken, true, newCollateralAssets);
    }

    /**
     * @dev Add borrow assets to MatrixToken. Updates the borrowAssetsEnabled and _enabledAssets mappings. Emits UpdateBorrowAssets event.
     */
    function _addBorrowAssets(IMatrixToken matrixToken, IERC20[] memory newBorrowAssets) internal {
        for (uint256 i = 0; i < newBorrowAssets.length; i++) {
            IERC20 borrowAsset = newBorrowAssets[i];
            _validateNewBorrowAsset(matrixToken, borrowAsset);
            _isEnabledBorrowAsset[matrixToken][borrowAsset] = true;
            _enabledAssets[matrixToken].borrowAssets.push(address(borrowAsset));
        }

        emit UpdateBorrowAssets(matrixToken, true, newBorrowAssets);
    }

    /**
     * @dev Updates MatrixToken's ability to use an asset as collateral on Aave
     * @notice Aave ENABLES an asset to be used as collateral by `to` address in an `aToken.transfer(to, amount)` call provided
     *       1. msg.sender (from address) isn't the same as `to` address
     *       2. `to` address had zero aToken balance before the transfer
     *       3. transfer `amount` is greater than 0
     *
     * @notice Aave DISABLES an asset to be used as collateral by `msg.sender`in an `aToken.transfer(to, amount)` call provided
     *       1. msg.sender (from address) isn't the same as `to` address
     *       2. msg.sender has zero balance after the transfer
     *
     *   Different states of the MatrixToken and what this function does in those states:
     *
     *       Case 1: Manager adds collateral asset to MatrixToken before first issuance
     *           - Since aToken.balanceOf(matrixToken) == 0, we do not call `matrixToken.invokeUserUseReserveAsCollateral` because Aave
     *           requires aToken balance to be greater than 0 before enabling/disabling the underlying asset to be used as collateral
     *           on Aave markets.
     *
     *       Case 2: First issuance of the MatrixToken
     *           - MatrixToken was initialized with aToken as default position
     *           - DebtIssuanceModule reads the default position and transfers corresponding aToken from the issuer to the MatrixToken
     *           - Aave enables aToken to be used as collateral by the MatrixToken
     *           - Manager calls lever() and the aToken is used as collateral to borrow other assets
     *
     *       Case 3: Manager removes collateral asset from the MatrixToken
     *           - Disable asset to be used as collateral on MatrixToken by calling `matrixToken.invokeSetUserUseReserveAsCollateral` with
     *           useAsCollateral equals false
     *           - Note: If health factor goes below 1 by removing the collateral asset, then Aave reverts on the above call, thus whole
     *           transaction reverts, and manager can't remove corresponding collateral asset
     *
     *       Case 4: Manager adds collateral asset after removing it
     *           - If aToken.balanceOf(matrixToken) > 0, we call `matrixToken.invokeUserUseReserveAsCollateral` and the corresponding aToken
     *           is re-enabled as collateral on Aave
     *
     *       Case 5: On redemption/delever/liquidated and aToken balance becomes zero
     *           - Aave disables aToken to be used as collateral by MatrixToken
     *
     *   Values of variables in below if condition and corresponding action taken:
     *
     *   ---------------------------------------------------------------------------------------------------------------------
     *   | usageAsCollateralEnabled |  useAsCollateral  |   aToken.balanceOf()  |     Action                                 |
     *   |--------------------------|-------------------|-----------------------|--------------------------------------------|
     *   |   true                   |   true            |      X                |   Skip invoke. Save gas.                   |
     *   |--------------------------|-------------------|-----------------------|--------------------------------------------|
     *   |   true                   |   false           |   greater than 0      |   Invoke and set to false.                 |
     *   |--------------------------|-------------------|-----------------------|--------------------------------------------|
     *   |   true                   |   false           |   = 0                 |   Impossible case. Aave disables usage as  |
     *   |                          |                   |                       |   collateral when aToken balance becomes 0 |
     *   |--------------------------|-------------------|-----------------------|--------------------------------------------|
     *   |   false                  |   false           |     X                 |   Skip invoke. Save gas.                   |
     *   |--------------------------|-------------------|-----------------------|--------------------------------------------|
     *   |   false                  |   true            |   greater than 0      |   Invoke and set to true.                  |
     *   |--------------------------|-------------------|-----------------------|--------------------------------------------|
     *   |   false                  |   true            |   = 0                 |   Don't invoke. Will revert.               |
     *   ---------------------------------------------------------------------------------------------------------------------
     */
    function _updateUseReserveAsCollateral(
        IMatrixToken matrixToken,
        IERC20 asset,
        bool useAsCollateral
    ) internal {
        (, , , , , , , , bool usageAsCollateralEnabled) = _protocolDataProvider.getUserReserveData(address(asset), address(matrixToken));

        if ((usageAsCollateralEnabled != useAsCollateral) && (_underlyingToReserveTokens[asset].aToken.balanceOf(address(matrixToken)) > 0)) {
            matrixToken.invokeSetUserUseReserveAsCollateral(ILendingPool(_lendingPoolAddressesProvider.getLendingPool()), address(asset), useAsCollateral);
        }
    }

    /**
     * @dev Validate common requirements for lever and delever
     */
    function _validateCommon(ActionInfo memory actionInfo) internal view {
        require(_isEnabledCollateralAsset[actionInfo.matrixToken][actionInfo.collateralAsset], "L11a"); // "Collateral not enabled"
        require(_isEnabledBorrowAsset[actionInfo.matrixToken][actionInfo.borrowAsset], "L11b"); // "Borrow not enabled"
        require(actionInfo.collateralAsset != actionInfo.borrowAsset, "L11c"); // "Collateral and borrow asset must be different"
        require(actionInfo.notionalSendQuantity > 0, "L11d"); // "Quantity is 0"
    }

    /**
     * @dev Validates if a new asset can be added as collateral asset for given MatrixToken
     */
    function _validateNewCollateralAsset(IMatrixToken matrixToken, IERC20 asset) internal view {
        require(!_isEnabledCollateralAsset[matrixToken][asset], "L12a"); // "Collateral already enabled"

        (address aToken, , ) = _protocolDataProvider.getReserveTokensAddresses(address(asset));

        require(address(_underlyingToReserveTokens[asset].aToken) == aToken, "L12b"); // "Invalid aToken address"

        (, , , , , bool usageAsCollateralEnabled, , , bool isActive, bool isFrozen) = _protocolDataProvider.getReserveConfigurationData(address(asset));

        // An active reserve is an alias for a valid reserve on Aave.
        // We are checking for the availability of the reserve directly on Aave rather than checking our internal `_underlyingToReserveTokens` mappings,
        // because our mappings can be out-of-date if a new reserve is added to Aave
        require(isActive, "L12c"); // "Invalid aave reserve"

        // A frozen reserve doesn't allow any new deposit, borrow or rate swap but allows repayments, liquidations and withdrawals
        require(!isFrozen, "L12d"); // "Frozen aave reserve"

        require(usageAsCollateralEnabled, "L12e"); // "Collateral disabled on Aave"
    }

    /**
     * @dev Validates if a new asset can be added as borrow asset for given MatrixToken
     */
    function _validateNewBorrowAsset(IMatrixToken matrixToken, IERC20 asset) internal view {
        require(!_isEnabledBorrowAsset[matrixToken][asset], "L13a"); // "Borrow already enabled"

        (, , address variableDebtToken) = _protocolDataProvider.getReserveTokensAddresses(address(asset));

        require(address(_underlyingToReserveTokens[asset].variableDebtToken) == variableDebtToken, "L13b"); // "Invalid variable debt token address")

        (, , , , , , bool borrowingEnabled, , bool isActive, bool isFrozen) = _protocolDataProvider.getReserveConfigurationData(address(asset));

        require(isActive, "L13c"); // "Invalid aave reserve"
        require(!isFrozen, "L13d"); // "Frozen aave reserve"
        require(borrowingEnabled, "L13e"); // "Borrowing disabled on Aave"
    }

    /**
     * @dev Reads aToken balance and calculates default position unit for given collateral aToken and MatrixToken
     *
     * @return uint256    default collateral position unit
     */
    function _getCollateralPosition(
        IMatrixToken matrixToken,
        IAToken aToken,
        uint256 matrixTotalSupply
    ) internal view returns (uint256) {
        uint256 collateralNotionalBalance = aToken.balanceOf(address(matrixToken));
        return collateralNotionalBalance.preciseDiv(matrixTotalSupply);
    }

    /**
     * @dev Reads variableDebtToken balance and calculates external position unit for given borrow asset and MatrixToken
     *
     * @return int256    external borrow position unit
     */
    function _getBorrowPosition(
        IMatrixToken matrixToken,
        IERC20 borrowAsset,
        uint256 matrixTotalSupply
    ) internal view returns (int256) {
        uint256 borrowNotionalBalance = _underlyingToReserveTokens[borrowAsset].variableDebtToken.balanceOf(address(matrixToken));
        int256 result = borrowNotionalBalance.preciseDivCeil(matrixTotalSupply).toInt256();

        return -result;
    }

    // ==================== Private functions ====================

    function _onlyAdmin() private view {
        require(hasRole(ADMIN_ROLE, _msgSender()), "L14");
    }
}
