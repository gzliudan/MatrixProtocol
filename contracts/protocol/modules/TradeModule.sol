// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/security/ReentrancyGuard.sol";

// ==================== Internal Imports ====================

import { ModuleBase } from "../lib/ModuleBase.sol";
import { PositionUtil } from "../lib/PositionUtil.sol";

import { IController } from "../../interfaces/IController.sol";
import { IMatrixToken } from "../../interfaces/IMatrixToken.sol";
import { IExchangeAdapter } from "../../interfaces/IExchangeAdapter.sol";

/**
 * @title TradeModule
 *
 * @dev Module that enables MatrixToken to perform atomic trades using Decentralized Exchanges
 * such as 1inch or Kyber. Integrations mappings are stored on the IntegrationRegistry contract.
 */
contract TradeModule is ModuleBase, ReentrancyGuard {
    using SafeCast for int256;
    using PositionUtil for IMatrixToken;

    // ==================== Constants ====================

    // 0 index stores the fee % charged in the trade function
    uint256 internal constant TRADE_MODULE_PROTOCOL_FEE_INDEX = 0;

    // ==================== Structs ====================

    struct TradeInfo {
        uint256 matrixTotalSupply; // Total supply of MatrixToken in Precise Units (10^18)
        uint256 totalSendQuantity; // Total quantity of sold token (position unit x total supply)
        uint256 totalMinReceiveQuantity; // Total minimum quantity of token to receive back
        uint256 preTradeSendTokenBalance; // Total initial balance of token being sold
        uint256 preTradeReceiveTokenBalance; // Total initial balance of token being bought
        address sendToken; // Address of token being sold
        address receiveToken; // Address of token being bought
        IMatrixToken matrixToken; // Instance of MatrixToken
        IExchangeAdapter exchangeAdapter; // Instance of exchange adapter contract
    }

    // ==================== Events ====================

    event ExchangeComponent(
        IMatrixToken indexed matrixToken,
        address indexed sendToken,
        address indexed receiveToken,
        IExchangeAdapter exchangeAdapter,
        uint256 totalSendAmount,
        uint256 totalReceiveAmount,
        uint256 protocolFee
    );

    // ==================== Constructor function ====================

    constructor(IController controller, string memory name) ModuleBase(controller, name) {}

    // ==================== External functions ====================

    /**
     * @dev Initializes this module to the MatrixToken. Only callable by the MatrixToken's manager.
     *
     * @param matrixToken    Instance of the MatrixToken to initialize
     */
    function initialize(IMatrixToken matrixToken) external onlyValidAndPendingMatrix(matrixToken) onlyMatrixManager(matrixToken, msg.sender) {
        matrixToken.initializeModule();
    }

    /**
     * @dev Executes a trade on a supported DEX. Only callable by the MatrixToken's manager.
     * Although the MatrixToken units are passed in for the send and receive quantities, the total quantity
     * sent and received is the quantity of MatrixToken units multiplied by the MatrixToken totalSupply.
     *
     * @param matrixToken           Instance of the MatrixToken to trade
     * @param exchangeName          Human readable name of the exchange in the integrations registry
     * @param sendToken             Address of the token to be sent to the exchange
     * @param sendQuantity          Units of token in MatrixToken sent to the exchange
     * @param receiveToken          Address of the token that will be received from the exchange
     * @param minReceiveQuantity    Min units of token in MatrixToken to be received from the exchange
     * @param data                  Arbitrary bytes to be used to construct trade call data
     */
    function trade(
        IMatrixToken matrixToken,
        string memory exchangeName,
        address sendToken,
        uint256 sendQuantity,
        address receiveToken,
        uint256 minReceiveQuantity,
        bytes memory data
    ) external nonReentrant onlyManagerAndValidMatrix(matrixToken) {
        TradeInfo memory tradeInfo = _createTradeInfo(matrixToken, exchangeName, sendToken, receiveToken, sendQuantity, minReceiveQuantity);

        _validatePreTradeData(tradeInfo, sendQuantity);
        _executeTrade(tradeInfo, data);

        uint256 exchangedQuantity = _validatePostTrade(tradeInfo);
        uint256 protocolFee = _accrueProtocolFee(tradeInfo, exchangedQuantity);
        (uint256 netSendAmount, uint256 netReceiveAmount) = _updateMatrixTokenPositions(tradeInfo);

        emit ExchangeComponent(matrixToken, sendToken, receiveToken, tradeInfo.exchangeAdapter, netSendAmount, netReceiveAmount, protocolFee);
    }

    /**
     * @dev Removes this module from the MatrixToken, via call by the MatrixToken.
     * Left with empty logic here because there are no check needed to verify removal.
     */
    function removeModule() external override {}

    // ==================== Internal functions ====================

    /**
     * @dev Create and return TradeInfo struct
     *
     * @param matrixToken           Instance of the MatrixToken to trade
     * @param exchangeName          Human readable name of the exchange in the integrations registry
     * @param sendToken             Address of the token to be sent to the exchange
     * @param receiveToken          Address of the token that will be received from the exchange
     * @param sendQuantity          Units of token in MatrixToken sent to the exchange
     * @param minReceiveQuantity    Min units of token in MatrixToken to be received from the exchange
     *
     * @return TradeInfo            Struct containing data for trade
     */
    function _createTradeInfo(
        IMatrixToken matrixToken,
        string memory exchangeName,
        address sendToken,
        address receiveToken,
        uint256 sendQuantity,
        uint256 minReceiveQuantity
    ) internal view returns (TradeInfo memory) {
        TradeInfo memory tradeInfo;
        tradeInfo.matrixToken = matrixToken;
        tradeInfo.exchangeAdapter = IExchangeAdapter(getAndValidateAdapter(exchangeName));
        tradeInfo.sendToken = sendToken;
        tradeInfo.receiveToken = receiveToken;
        tradeInfo.matrixTotalSupply = matrixToken.totalSupply();
        tradeInfo.totalSendQuantity = PositionUtil.getDefaultTotalNotional(tradeInfo.matrixTotalSupply, sendQuantity);
        tradeInfo.totalMinReceiveQuantity = PositionUtil.getDefaultTotalNotional(tradeInfo.matrixTotalSupply, minReceiveQuantity);
        tradeInfo.preTradeSendTokenBalance = IERC20(sendToken).balanceOf(address(matrixToken));
        tradeInfo.preTradeReceiveTokenBalance = IERC20(receiveToken).balanceOf(address(matrixToken));

        return tradeInfo;
    }

    /**
     * @dev Validate pre trade data. Check exchange is valid, token quantity is valid.
     *
     * @param tradeInfo       Struct containing trade information used in internal functions
     * @param sendQuantity    Units of token in MatrixToken sent to the exchange
     */
    function _validatePreTradeData(TradeInfo memory tradeInfo, uint256 sendQuantity) internal view {
        require(tradeInfo.totalSendQuantity > 0, "TM0a"); // "Token to sell must be nonzero"
        require(tradeInfo.matrixToken.hasSufficientDefaultUnits(tradeInfo.sendToken, sendQuantity), "TM0b"); // "Unit cant be greater than existing"
    }

    /**
     * @dev Invoke approve for send token, get method data and invoke trade in the context of the MatrixToken.
     *
     * @param tradeInfo    Struct containing trade information used in internal functions
     * @param data         Arbitrary bytes to be used to construct trade call data
     */
    function _executeTrade(TradeInfo memory tradeInfo, bytes memory data) internal {
        // Get spender address from exchange adapter and invoke approve for exact amount on MatrixToken
        tradeInfo.matrixToken.invokeSafeIncreaseAllowance(tradeInfo.sendToken, tradeInfo.exchangeAdapter.getSpender(), tradeInfo.totalSendQuantity);

        (address targetExchange, uint256 callValue, bytes memory methodData) = tradeInfo.exchangeAdapter.getTradeCalldata(
            tradeInfo.sendToken,
            tradeInfo.receiveToken,
            address(tradeInfo.matrixToken),
            tradeInfo.totalSendQuantity,
            tradeInfo.totalMinReceiveQuantity,
            data
        );

        tradeInfo.matrixToken.invoke(targetExchange, callValue, methodData);
    }

    /**
     * @dev Validate post trade data.
     *
     * @param tradeInfo    Struct containing trade information used in internal functions
     *
     * @return uint256     Total quantity of receive token that was exchanged
     */
    function _validatePostTrade(TradeInfo memory tradeInfo) internal view returns (uint256) {
        uint256 exchangedQuantity = IERC20(tradeInfo.receiveToken).balanceOf(address(tradeInfo.matrixToken)) - tradeInfo.preTradeReceiveTokenBalance;

        require(exchangedQuantity >= tradeInfo.totalMinReceiveQuantity, "TM1"); // "Slippage greater than allowed"

        return exchangedQuantity;
    }

    /**
     * @dev Retrieve fee from controller and calculate total protocol fee and send from MatrixToken to protocol recipient
     *
     * @param tradeInfo    Struct containing trade information used in internal functions
     *
     * @return uint256     Amount of receive token taken as protocol fee
     */
    function _accrueProtocolFee(TradeInfo memory tradeInfo, uint256 exchangedQuantity) internal returns (uint256) {
        uint256 protocolFeeTotal = getModuleFee(TRADE_MODULE_PROTOCOL_FEE_INDEX, exchangedQuantity);

        payProtocolFeeFromMatrixToken(tradeInfo.matrixToken, tradeInfo.receiveToken, protocolFeeTotal);

        return protocolFeeTotal;
    }

    /**
     * @dev Update MatrixToken positions
     *
     * @param tradeInfo    Struct containing trade information used in internal functions
     *
     * @return uint256     Amount of sendTokens used in the trade
     * @return uint256     Amount of receiveTokens received in the trade (net of fees)
     */
    function _updateMatrixTokenPositions(TradeInfo memory tradeInfo) internal returns (uint256, uint256) {
        (uint256 currentSendTokenBalance, , ) = tradeInfo.matrixToken.calculateAndEditDefaultPosition(
            tradeInfo.sendToken,
            tradeInfo.matrixTotalSupply,
            tradeInfo.preTradeSendTokenBalance
        );

        (uint256 currentReceiveTokenBalance, , ) = tradeInfo.matrixToken.calculateAndEditDefaultPosition(
            tradeInfo.receiveToken,
            tradeInfo.matrixTotalSupply,
            tradeInfo.preTradeReceiveTokenBalance
        );

        return (tradeInfo.preTradeSendTokenBalance - currentSendTokenBalance, currentReceiveTokenBalance - tradeInfo.preTradeReceiveTokenBalance);
    }
}
