import { OrderPacket, SelfTradeBehavior, Side } from "./types";
import * as beet from "@metaplex-foundation/beet";

/// PostOnlyOrderTemplate is a helper type for creating a post-only order, which will never be matched against existing orders.
/// The template allows you to specify the price and size in commonly understood units:
/// price is the floating point price (units of USDC per unit of SOL for the SOL/USDC market), and size is in whole base units (units of SOL for the SOL/USDC market).
/// The SDK can then convert this to a post-only order instruction, ready to be sent.
export class PostOnlyOrderTemplate {
  // The side for the order, a Side::Bid or a Side::Ask.
  side: Side;

  /// The price of the order, as the commonly understood exchange price (the number of quote units to exchange for one base unit), as a floating point number.
  priceAsFloat: number;

  /// Total number of base units to place on the book or fill at a better price.
  sizeInBaseUnits: number;

  /// Client order id used to identify the order in the response to the client.
  clientOrderId: number;

  /// Flag for whether or not to reject the order if it would immediately match or amend it to the best non-crossing price.
  /// Default value is true.
  rejectPostOnly: boolean;

  /// Flag for whether or not the order should only use funds that are already in the account.
  /// Using only deposited funds will allow the trader to pass in fewer accounts per instruction and
  /// save transaction space as well as compute.
  useOnlyDepositedFunds: boolean;

  /// If this is set, the order will be invalid after the specified slot.
  lastValidSlot?: number;

  /// If this is set, the order will be invalid after the specified unix timestamp.
  lastValidUnixTimestampInSeconds: number;
}
/// LimitOrderTemplate is a helper type for creating a limit order.
/// The template allows you to specify the price and size in commonly understood units:
/// price is the floating point price (units of USDC per unit of SOL for the SOL/USDC market), and size is in whole base units (units of SOL for the SOL/USDC market).
/// The SDK can then convert this to a limit order instruction, ready to be sent.
export class LimitOrderTemplate {
  // The side for the order, a Side::Bid or a Side::Ask.
  side: Side;

  /// The price of the order, as the commonly understood exchange price (the number of quote units to exchange for one base unit), as a floating point number.
  priceAsFloat: number;

  /// Total number of base units to place on the book or fill at a better price.
  sizeInBaseUnits: number;

  /// How the matching engine should handle a self trade.
  selfTradeBehavior: SelfTradeBehavior;

  /// Number of orders to match against. If this is `None` there is no limit.
  matchLimit?: number;

  /// Client order id used to identify the order in the response to the client.
  clientOrderId: number;

  // Flag for whether or not the order should only use funds that are already in the account.
  /// Using only deposited funds will allow the trader to pass in fewer accounts per instruction and
  /// save transaction space as well as compute.
  useOnlyDepositedFunds: boolean;

  /// If this is set, the order will be invalid after the specified slot.
  lastValidSlot?: number;

  /// If this is set, the order will be invalid after the specified unix timestamp.
  lastValidUnixTimestampInSeconds?: number;
}

/// ImmediateOrCancelOrderTemplate is a helper type for creating an immediate or cancel order.
/// The template allows you to specify the price and size in commonly understood units:
/// price is the floating point price (units of USDC per unit of SOL for the SOL/USDC market), and size is in whole base units (units of SOL for the SOL/USDC market).
/// The SDK can then convert this to a limit order instruction, ready to be sent.
///
/// Immediate-or-cancel orders will be matched against existing resting orders.
/// If the order matches fewer than `minUnits`, it will be cancelled.
///
/// Fill or Kill (FOK) orders are a subset of Immediate or Cancel (IOC) orders where either
/// the `sizeInBaseUnits` is equal to the `minBaseUnitsToFill` of the order, or the `sizeInQuoteUnits` is
/// equal to the `minQuoteUnitsToFill` of the order.
export class ImmediateOrCancelOrderTemplate {
  // The side for the order, a Side::Bid or a Side::Ask.
  side: Side;

  /// The most aggressive price an order can be matched at. If this value is None, then the order
  /// is treated as a market order.
  priceAsFloat: number;

  /// The number of base units to fill against the order book. Either this parameter or the `sizeInQuoteUnits`
  /// parameter must be set to a nonzero value.
  sizeInBaseUnits: number;

  /// The number of quote units to fill against the order book. Either this parameter or the `sizeInBaseUnits`
  /// parameter must be set to a nonzero value.
  sizeInQuoteUnits: number;

  /// The minimum number of base units to fill against the order book. If the order does not fill
  /// this many base lots, it will be voided.
  minBaseUnitsToFill: number;

  /// The minimum number of quote units to fill against the order book. If the order does not fill
  /// this many quote lots, it will be voided.
  minQuoteUnitsToFill: number;

  /// How the matching engine should handle a self trade.
  selfTradeBehavior: SelfTradeBehavior;

  /// Number of orders to match against. If set to `None`, there is no limit.
  matchLimit?: number;

  /// Client order id used to identify the order in the response to the client.
  clientOrderId: number;

  /// Flag for whether or not the order should only use funds that are already in the account.
  /// Using only deposited funds will allow the trader to pass in less accounts per instruction and
  /// save transaction space as well as compute. This is only for traders who have a seat.
  useOnlyDepositedFunds: boolean;

  /// If this is set, the order will be invalid after the specified slot.
  lastValidSlot?: number;

  /// If this is set, the order will be invalid after the specified unix timestamp.
  lastValidUnixTimestampInSeconds?: number;
}

/**
 * Returns a post only order packet.
 * @param side The side of the order
 * @param priceInTicks The price of the order in ticks
 * @param numBaseLots The number of base lots to trade
 * @param clientOrderId The client order id
 * @param rejectPostOnly Whether a post only order should be rejcted if it crosses. Default is true.
 * @param useOnlyDepositedFunds Whether to use only deposited funds
 * @param lastValidSlot The last valid slot for a time in force order
 * @param lastValidUnixTimestampInSeconds The last valid unix timestamp in seconds for a time in force order
 */
export function getPostOnlyOrderPacket({
  side,
  priceInTicks,
  numBaseLots,
  rejectPostOnly = true,
  clientOrderId = 0,
  useOnlyDepositedFunds = false,
  lastValidSlot,
  lastValidUnixTimestampInSeconds,
}: {
  side: Side;
  priceInTicks: number;
  numBaseLots: number;
  rejectPostOnly?: boolean;
  clientOrderId?: number;
  useOnlyDepositedFunds?: boolean;
  lastValidSlot?: beet.COption<beet.bignum>;
  lastValidUnixTimestampInSeconds?: beet.COption<beet.bignum>;
}): OrderPacket {
  return {
    __kind: "PostOnly",
    side,
    priceInTicks,
    numBaseLots,
    clientOrderId: clientOrderId ?? 0,
    rejectPostOnly: rejectPostOnly ?? true,
    useOnlyDepositedFunds: useOnlyDepositedFunds ?? false,
    lastValidSlot,
    lastValidUnixTimestampInSeconds,
  };
}

/**
 * Returns a limit order packet
 * @param side The side of the order
 * @param priceInTicks The price of the order in ticks
 * @param numBaseLots The number of base lots to trade
 * @param selfTradeBehavior The self trade behavior
 * @param clientOrderId The client order id
 * @param useOnlyDepositedFunds Whether to use only deposited funds
 * @param lastValidSlot The last valid slot for a time in force order
 * @param lastValidUnixTimestampInSeconds The last valid unix timestamp in seconds for a time in force order
 */
export function getLimitOrderPacket({
  side,
  priceInTicks = null,
  numBaseLots,
  selfTradeBehavior = SelfTradeBehavior.CancelProvide,
  matchLimit,
  clientOrderId = 0,
  useOnlyDepositedFunds = false,
  lastValidSlot,
  lastValidUnixTimestampInSeconds,
}: {
  side: Side;
  priceInTicks: number;
  numBaseLots: number;
  selfTradeBehavior?: SelfTradeBehavior;
  matchLimit?: beet.COption<beet.bignum>;
  clientOrderId?: number;
  useOnlyDepositedFunds?: boolean;
  lastValidSlot?: beet.COption<beet.bignum>;
  lastValidUnixTimestampInSeconds?: beet.COption<beet.bignum>;
}): OrderPacket {
  return {
    __kind: "Limit",
    side,
    priceInTicks,
    numBaseLots,
    selfTradeBehavior: selfTradeBehavior ?? SelfTradeBehavior.CancelProvide,
    matchLimit,
    clientOrderId: clientOrderId ?? 0,
    useOnlyDepositedFunds: useOnlyDepositedFunds ?? false,
    lastValidSlot,
    lastValidUnixTimestampInSeconds,
  };
}

/**
 * Returns an immediate-or-cancel order packet.
 * @param side The side of the order
 * @param priceInTicks The price of the order in ticks
 * @param numBaseLots The number of base lots to trade
 * @param numQuoteLots The number of quote lots to trade
 * @param minBaseLotsToFill The minimum number of base lots to fill
 * @param minQuoteLotsToFill The minimum number of quote lots to fill
 * @param selfTradeBehavior The self trade behavior
 * @param matchLimit The match limit
 * @param clientOrderId The client order id
 * @param useOnlyDepositedFunds Whether to use only deposited funds
 * @param lastValidSlot The last valid slot for a time in force order
 * @param lastValidUnixTimestampInSeconds The last valid unix timestamp in seconds for a time in force order
 */
export function getImmediateOrCancelOrderPacket({
  side,
  priceInTicks = null,
  numBaseLots,
  numQuoteLots,
  minBaseLotsToFill = 0,
  minQuoteLotsToFill = 0,
  selfTradeBehavior = SelfTradeBehavior.CancelProvide,
  matchLimit,
  clientOrderId = 0,
  useOnlyDepositedFunds = false,
  lastValidSlot,
  lastValidUnixTimestampInSeconds,
}: {
  side: Side;
  priceInTicks?: number;
  numBaseLots: number;
  numQuoteLots: number;
  minBaseLotsToFill?: number;
  minQuoteLotsToFill?: number;
  selfTradeBehavior?: SelfTradeBehavior;
  matchLimit?: beet.COption<beet.bignum>;
  clientOrderId?: number;
  useOnlyDepositedFunds?: boolean;
  lastValidSlot?: beet.COption<beet.bignum>;
  lastValidUnixTimestampInSeconds?: beet.COption<beet.bignum>;
}): OrderPacket {
  return {
    __kind: "ImmediateOrCancel",
    side,
    priceInTicks,
    numBaseLots,
    numQuoteLots,
    minBaseLotsToFill,
    minQuoteLotsToFill,
    selfTradeBehavior,
    matchLimit,
    clientOrderId,
    useOnlyDepositedFunds,
    lastValidSlot,
    lastValidUnixTimestampInSeconds,
  };
}
