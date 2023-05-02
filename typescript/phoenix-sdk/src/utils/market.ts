import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import BN from "bn.js";
import * as beet from "@metaplex-foundation/beet";

import {
  CancelOrderParams,
  marketHeaderBeet,
  OrderPacket,
  Side,
} from "../types";
import { sign, toBN, toNum } from "./numbers";
import {
  orderIdBeet,
  publicKeyBeet,
  restingOrderBeet,
  traderStateBeet,
} from "./beet";
import {
  L3Book,
  L3Order,
  L3UiBook,
  L3UiOrder,
  Market,
  OrderId,
  PROGRAM_ID,
  UiLadderLevel,
} from "..";
import { Ladder, UiLadder, MarketData, TraderState } from "../market";
import { getCreateTokenAccountInstructions } from "./token";

import { confirmOrCreateClaimSeatIxs } from "./seatManager";

// Default ladder depth to use when fetching L2 ladder
export const DEFAULT_L2_LADDER_DEPTH = 10;

// Default book depth tho use when fetching L3 book
export const DEFAULT_L3_BOOK_DEPTH = 20;

export const DEFAULT_MATCH_LIMIT = 2048;
export const DEFAULT_SLIPPAGE_PERCENT = 0.005;

/**
 * Find the trader's seat account on Phoenix market.
 * If the trader does not have a seat account, the PDA seat pubkey will still be returned.
 * In that case, the seat account will need to be initialized with the claim seat instruction.
 * @param marketPubkey The market's address
 * @param trader The trader's address
 */
export function getSeatAddress(
  market: PublicKey,
  trader: PublicKey
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("seat"), market.toBuffer(), trader.toBuffer()],
    PROGRAM_ID
  )[0];
}

/**
 * Deserializes market data from a given buffer and returns a `MarketData` object
 *
 * @param data The data buffer to deserialize
 */
export function deserializeMarketData(data: Buffer): MarketData {
  // Deserialize the market header
  let offset = marketHeaderBeet.byteSize;
  const [header] = marketHeaderBeet.deserialize(data.subarray(0, offset));

  // Parse market data
  const paddingLen = 8 * 32;
  let remaining = data.subarray(offset + paddingLen);
  offset = 0;
  const baseLotsPerBaseUnit = Number(remaining.readBigUInt64LE(offset));
  offset += 8;
  const quoteLotsPerBaseUnitPerTick = Number(remaining.readBigUInt64LE(offset));
  offset += 8;
  const sequenceNumber = Number(remaining.readBigUInt64LE(offset));
  offset += 8;
  const takerFeeBps = Number(remaining.readBigUInt64LE(offset));
  offset += 8;
  const collectedQuoteLotFees = Number(remaining.readBigUInt64LE(offset));
  offset += 8;
  const unclaimedQuoteLotFees = Number(remaining.readBigUInt64LE(offset));
  offset += 8;
  remaining = remaining.subarray(offset);

  // Parse bids, asks and traders
  const numBids = toNum(header.marketSizeParams.bidsSize);
  const numAsks = toNum(header.marketSizeParams.asksSize);
  const numTraders = toNum(header.marketSizeParams.numSeats);

  const bidsSize =
    16 + 16 + (16 + orderIdBeet.byteSize + restingOrderBeet.byteSize) * numBids;
  const asksSize =
    16 + 16 + (16 + orderIdBeet.byteSize + restingOrderBeet.byteSize) * numAsks;
  const tradersSize =
    16 + 16 + (16 + 32 + traderStateBeet.byteSize) * numTraders;
  offset = 0;

  const bidBuffer = remaining.subarray(offset, offset + bidsSize);
  offset += bidsSize;
  const askBuffer = remaining.subarray(offset, offset + asksSize);
  offset += asksSize;
  const traderBuffer = remaining.subarray(offset, offset + tradersSize);

  const bidsUnsorted = deserializeRedBlackTree(
    bidBuffer,
    orderIdBeet,
    restingOrderBeet
  );

  const asksUnsorted = deserializeRedBlackTree(
    askBuffer,
    orderIdBeet,
    restingOrderBeet
  );

  // Sort bids in descending order of price, and ascending order of sequence number
  const bids = [...bidsUnsorted].sort((a, b) => {
    const priceComparison = sign(
      toBN(b[0].priceInTicks).sub(toBN(a[0].priceInTicks))
    );
    if (priceComparison !== 0) {
      return priceComparison;
    }
    return sign(
      getUiOrderSequenceNumber(a[0]).sub(getUiOrderSequenceNumber(b[0]))
    );
  });

  // Sort asks in ascending order of price, and ascending order of sequence number
  const asks = [...asksUnsorted].sort((a, b) => {
    const priceComparison = sign(
      toBN(a[0].priceInTicks).sub(toBN(b[0].priceInTicks))
    );
    if (priceComparison !== 0) {
      return priceComparison;
    }
    return sign(
      getUiOrderSequenceNumber(a[0]).sub(getUiOrderSequenceNumber(b[0]))
    );
  });

  const traders = new Map<string, TraderState>();
  for (const [k, traderState] of deserializeRedBlackTree(
    traderBuffer,
    publicKeyBeet,
    traderStateBeet
  )) {
    traders.set(k.publicKey.toString(), traderState);
  }

  const traderPubkeyToTraderIndex = new Map<string, number>();
  const traderIndexToTraderPubkey = new Map<number, string>();
  for (const [k, index] of getNodeIndices(
    traderBuffer,
    publicKeyBeet,
    traderStateBeet
  )) {
    traderPubkeyToTraderIndex.set(k.publicKey.toString(), index);
    traderIndexToTraderPubkey.set(index, k.publicKey.toString());
  }

  return {
    header,
    baseLotsPerBaseUnit,
    quoteLotsPerBaseUnitPerTick,
    sequenceNumber,
    takerFeeBps,
    collectedQuoteLotFees,
    unclaimedQuoteLotFees,
    bids,
    asks,
    traders,
    traderPubkeyToTraderIndex,
    traderIndexToTraderPubkey,
  };
}

/**
 * Deserializes a RedBlackTree from a given buffer
 * @description This deserialized the RedBlackTree defined in the sokoban library: https://github.com/Ellipsis-Labs/sokoban/tree/master
 *
 * @param data The data buffer to deserialize
 * @param keyDeserializer The deserializer for the tree key
 * @param valueDeserializer The deserializer for the tree value
 */
function deserializeRedBlackTree<Key, Value>(
  data: Buffer,
  keyDeserializer: beet.BeetArgsStruct<Key>,
  valueDeserializer: beet.BeetArgsStruct<Value>
): Map<Key, Value> {
  const tree = new Map<Key, Value>();
  const treeNodes = deserializeRedBlackTreeNodes(
    data,
    keyDeserializer,
    valueDeserializer
  );

  const nodes = treeNodes[0];
  const freeNodes = treeNodes[1];

  for (const [index, [key, value]] of nodes.entries()) {
    if (!freeNodes.has(index)) {
      tree.set(key, value);
    }
  }

  return tree;
}

/**
 * Deserializes the RedBlackTree to return a map of keys to indices
 *
 * @param data The trader data buffer to deserialize
 * @param keyDeserializer The deserializer for the tree key
 * @param valueDeserializer The deserializer for the tree value
 */
function getNodeIndices<Key, Value>(
  data: Buffer,
  keyDeserializer: beet.BeetArgsStruct<Key>,
  valueDeserializer: beet.BeetArgsStruct<Value>
): Map<Key, number> {
  const indexMap = new Map<Key, number>();
  const treeNodes = deserializeRedBlackTreeNodes(
    data,
    keyDeserializer,
    valueDeserializer
  );

  const nodes = treeNodes[0];
  const freeNodes = treeNodes[1];

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for (const [index, [key]] of nodes.entries()) {
    if (!freeNodes.has(index)) {
      indexMap.set(key, index + 1);
    }
  }

  return indexMap;
}

/**
 * Takes a raw order ID and returns a displayable order sequence number
 *
 * On the raw order book, sequence numbers are stored as unsigned 64-bit integers,
 * with bits inverted for bids and left as-is for asks. This function converts
 * the raw order ID to a signed 64-bit integer, and then converts it to a
 * displayable order sequence number.
 *
 * @param orderId
 */
export function getUiOrderSequenceNumber(orderId: OrderId): BN {
  const twosComplement = (orderId.orderSequenceNumber as BN).fromTwos(64);
  return twosComplement.isNeg()
    ? twosComplement.neg().sub(new BN(1))
    : twosComplement;
}

/**
 * Returns the order sequence number used to build a cancel order instruction from an L3 order
 * @param order
 */
export function getOrderSequenceNumberFromL3Order(order: L3Order): BN {
  let orderSequenceNumber = order.orderSequenceNumber;
  if (order.side === Side.Bid) {
    orderSequenceNumber = orderSequenceNumber.add(toBN(1)).neg().toTwos(64);
  }
  return orderSequenceNumber;
}

/**
 * Returns the cancel order params used to build a cancel order instruction from an L3 order
 * @param order
 */
export function getCancelOrderParamsFromL3Order(
  order: L3Order
): CancelOrderParams {
  return {
    side: order.side,
    orderSequenceNumber: getOrderSequenceNumberFromL3Order(order),
    priceInTicks: order.priceInTicks,
  };
}

/**
 * Deserializes a RedBlackTree from a given buffer and returns the nodes and free nodes
 * @description This deserializes the RedBlackTree defined in the sokoban library: https://github.com/Ellipsis-Labs/sokoban/tree/master
 *
 * @param data The data buffer to deserialize
 * @param keyDeserializer The deserializer for the tree key
 * @param valueDeserializer The deserializer for the tree value
 */
function deserializeRedBlackTreeNodes<Key, Value>(
  data: Buffer,
  keyDeserializer: beet.BeetArgsStruct<Key>,
  valueDeserializer: beet.BeetArgsStruct<Value>
): [Array<[Key, Value]>, Set<number>] {
  let offset = 0;
  const keySize = keyDeserializer.byteSize;
  const valueSize = valueDeserializer.byteSize;

  const nodes = new Array<[Key, Value]>();

  // Skip RBTree header
  offset += 16;

  // Skip node allocator size
  offset += 8;
  const bumpIndex = data.readInt32LE(offset);
  offset += 4;
  let freeListHead = data.readInt32LE(offset);
  offset += 4;

  const freeListPointers = new Array<[number, number]>();

  for (let index = 0; offset < data.length && index < bumpIndex - 1; index++) {
    const registers = new Array<number>();
    for (let i = 0; i < 4; i++) {
      registers.push(data.readInt32LE(offset)); // skip padding
      offset += 4;
    }
    const [key] = keyDeserializer.deserialize(
      data.subarray(offset, offset + keySize)
    );
    offset += keySize;
    const [value] = valueDeserializer.deserialize(
      data.subarray(offset, offset + valueSize)
    );
    offset += valueSize;
    nodes.push([key, value]);
    freeListPointers.push([index, registers[0]]);
  }
  const freeNodes = new Set<number>();
  let indexToRemove = freeListHead - 1;

  let counter = 0;
  // If there's an infinite loop here, that means that the state is corrupted
  while (freeListHead < bumpIndex) {
    // We need to subtract 1 because the node allocator is 1-indexed
    const next = freeListPointers[freeListHead - 1];
    [indexToRemove, freeListHead] = next;
    freeNodes.add(indexToRemove);
    counter += 1;
    if (counter > bumpIndex) {
      throw new Error("Infinite loop detected");
    }
  }

  return [nodes, freeNodes];
}

/**
 * Returns an L2 ladder of bids and asks for given `MarketData`
 * @description Bids are ordered in descending order by price, and asks are ordered in ascending order by price
 *
 * @param market The `Market` to get the ladder from
 * @param slot The current slot
 * @param unixTimestamp The current Unix timestamp, in seconds
 * @param levels The number of book levels to return, -1 to return the entire book
 */
export function getMarketLadder(
  market: Market,
  slot: beet.bignum,
  unixTimestamp: beet.bignum,
  levels: number = DEFAULT_L2_LADDER_DEPTH
): Ladder {
  return market.getLadder(slot, unixTimestamp, levels);
}

/**
 * Converts a ladder level from BN to JS number representation
 *
 * @param marketData The `MarketData` the ladder was taken from
 * @param priceInTicks The price of the level in ticks
 * @param sizeInBaseLots The size of the level in base lots
 * @param quoteAtomsPerQuoteUnit The number of quote atoms per quote unit
 */
export function levelToUiLevel(
  market: Market,
  priceInTicks: number,
  sizeInBaseLots: number
): UiLadderLevel {
  return market.levelToUiLevel(priceInTicks, sizeInBaseLots);
}

/**
 * Returns the ladder of bids and asks as JS numbers for given `MarketData`
 *
 * @param maata The `Market` to get the ladder from
 * @param levels The number of book levels to return
 */
export function getMarketUiLadder(
  market: Market,
  levels: number = DEFAULT_L2_LADDER_DEPTH,
  slot: beet.bignum = 0,
  unixTimestamp: beet.bignum = 0
): UiLadder {
  return market.getUiLadder(levels, slot, unixTimestamp);
}

/**
 * Pretty prints the market's ladder as a colored orderbook
 *
 * @param uiLadder The ladder (represented by JS numbers) to print
 */
export function printUiLadder(uiLadder: UiLadder) {
  const bids = uiLadder.bids;
  const asks = uiLadder.asks;

  const maxBaseSize = Math.max(
    ...bids.map((b) => b[1]),
    ...asks.map((a) => a[1])
  );
  const maxBaseSizeLength = maxBaseSize.toString().length;

  const printLine = (price: number, size: number, color: "red" | "green") => {
    const priceStr = price.toFixed(3);
    const sizeStr = size.toFixed(2).padStart(maxBaseSizeLength, " ");
    console.log(
      priceStr + `\u001b[3${color === "green" ? 2 : 1}m` + sizeStr + "\u001b[0m"
    );
  };
  // Reverse the asks so the display order is descending in price
  console.log("\u001b[30mAsks\u001b[0m");
  for (const { price, quantity } of asks.reverse()) {
    printLine(price, quantity, "red");
  }

  console.log("\u001b[30mBids\u001b[0m");
  for (const { price, quantity } of bids) {
    printLine(price, quantity, "green");
  }
}

/**
 * Returns the L3 book of bids and asks for a given `MarketData`.
 * @description Bids are ordered in descending order by price, and asks are ordered in ascending order by price
 *
 * @param marketData The `MarketData` to get the ladder from
 * @param slot The current slot
 * @param unixTimestamp The current Unix timestamp, in seconds
 * @param ordersPerSide The max number of orders to return per side. -1 to return the entire book
 */
export function getMarketL3Book(
  marketData: MarketData,
  slot: beet.bignum,
  unixTimestamp: beet.bignum,
  ordersPerSide: number = DEFAULT_L3_BOOK_DEPTH
): L3Book {
  const bids: L3Order[] = [];
  const asks: L3Order[] = [];

  for (const side of [Side.Ask, Side.Bid]) {
    const book = side === Side.Ask ? marketData.asks : marketData.bids;
    for (const [orderId, restingOrder] of book) {
      if (
        restingOrder.lastValidSlot != 0 &&
        restingOrder.lastValidSlot < slot
      ) {
        continue;
      }
      if (
        restingOrder.lastValidUnixTimestampInSeconds != 0 &&
        restingOrder.lastValidUnixTimestampInSeconds < unixTimestamp
      ) {
        continue;
      }
      const priceInTicks = toBN(orderId.priceInTicks);
      const numBaseLots = toBN(restingOrder.numBaseLots);

      const order: L3Order = {
        priceInTicks,
        sizeInBaseLots: numBaseLots,
        side,
        makerPubkey: marketData.traderIndexToTraderPubkey.get(
          toNum(restingOrder.traderIndex)
        ),
        orderSequenceNumber: getUiOrderSequenceNumber(orderId),
        lastValidSlot: toBN(restingOrder.lastValidSlot),
        lastValidUnixTimestampInSeconds: toBN(
          restingOrder.lastValidUnixTimestampInSeconds
        ),
      };
      if (side === Side.Ask) {
        asks.push(order);
      } else {
        bids.push(order);
      }

      if (side === Side.Ask && asks.length === ordersPerSide) {
        break;
      }
      if (side === Side.Bid && bids.length === ordersPerSide) {
        break;
      }
    }
  }

  return {
    asks,
    bids,
  };
}

/**
 * Returns the L3 book of bids and asks as JS numbers
 *
 * @param marketData The `MarketData` to get the ladder from
 * @param levels The number of book levels to return
 */
export function getMarketL3UiBook(
  marketData: MarketData,
  ordersPerSide: number = DEFAULT_L3_BOOK_DEPTH,
  slot: beet.bignum = 0,
  unixTimestamp: beet.bignum = 0
): L3UiBook {
  const l3Book = getMarketL3Book(
    marketData,
    slot,
    unixTimestamp,
    ordersPerSide
  );

  return {
    bids: l3Book.bids.map((b) => getL3UiOrder(b, marketData)),
    asks: l3Book.asks.map((a) => getL3UiOrder(a, marketData)),
  };
}

/**
 * Converts a L3 order from BN to JS number representation
 *
 * @param l3Order The L3 order to convert
 * @param marketData The `MarketData` the order was taken from
 */
function getL3UiOrder(l3Order: L3Order, marketData: MarketData): L3UiOrder {
  return {
    price:
      (toNum(l3Order.priceInTicks) *
        marketData.quoteLotsPerBaseUnitPerTick *
        toNum(marketData.header.quoteLotSize)) /
      (10 ** marketData.header.quoteParams.decimals *
        marketData.header.rawBaseUnitsPerBaseUnit),
    side: l3Order.side,
    size:
      (toNum(l3Order.sizeInBaseLots) *
        marketData.header.rawBaseUnitsPerBaseUnit) /
      marketData.baseLotsPerBaseUnit,
    makerPubkey: l3Order.makerPubkey,
    orderSequenceNumber: l3Order.orderSequenceNumber.toString(),
    lastValidSlot: toNum(l3Order.lastValidSlot),
    lastValidUnixTimestampInSeconds: toNum(
      l3Order.lastValidUnixTimestampInSeconds
    ),
  };
}

/**
 * Returns a Phoenix swap transaction
 *
 * @param market The market object
 * @param trader The `PublicKey` of the trader
 * @param side The side of the order to place (Bid, Ask)
 * @param inAmount The amount (in whole tokens) of the input token to swap
 * @param slippage The slippage tolerance (optional, default 0.5%)
 * @param clientOrderId The client order ID (optional)
 * @param idempotent If set to true, the transaction will idempotently create both mint accounts (optional, default false)
 */
export function getMarketSwapTransaction({
  market,
  trader,
  side,
  inAmount,
  slippage = DEFAULT_SLIPPAGE_PERCENT,
  clientOrderId = 0,
  idempotent = false,
}: {
  market: Market;
  trader: PublicKey;
  side: Side;
  inAmount: number;
  slippage?: number;
  clientOrderId?: number;
  idempotent?: boolean;
}): Transaction {
  const quoteMintKey = market.data.header.quoteParams.mintKey;
  const baseMintKey = market.data.header.baseParams.mintKey;

  const baseTokenAccountKey = market.getBaseAccountKey(trader);
  const quoteTokenAccountKey = market.getQuoteAccountKey(trader);

  const swapTransaction = new Transaction();

  if (baseMintKey.equals(NATIVE_MINT) || idempotent) {
    swapTransaction.add(
      createAssociatedTokenAccountIdempotentInstruction(
        trader,
        baseTokenAccountKey,
        trader,
        baseMintKey,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
  }

  if (quoteMintKey.equals(NATIVE_MINT) || idempotent) {
    swapTransaction.add(
      createAssociatedTokenAccountIdempotentInstruction(
        trader,
        quoteTokenAccountKey,
        trader,
        quoteMintKey,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
  }

  const orderPacket = market.getSwapOrderPacket({
    side,
    inAmount,
    slippage,
    clientOrderId,
  });

  const swapInstruction = market.createSwapInstruction(orderPacket, trader);

  swapTransaction.add(swapInstruction);

  // Only close the token accounts if they are native mints
  if (baseMintKey.equals(NATIVE_MINT)) {
    swapTransaction.add(
      createCloseAccountInstruction(baseTokenAccountKey, trader, trader)
    );
  }

  if (quoteMintKey.equals(NATIVE_MINT)) {
    swapTransaction.add(
      createCloseAccountInstruction(quoteTokenAccountKey, trader, trader)
    );
  }

  return swapTransaction;
}

/**
 * Given a side and an amount in, returns the expected amount out.
 *
 * @param uiLadder The uiLadder for the market. Note that prices in the uiLadder are in quote units per raw base unit (units of USDC per unit of SOL for the SOL/USDC market).
 * @param side The side of the order
 * @param takerFeeBps The taker fee in bps
 * @param inAmount The amount of the input token. Amounts are in quote units for bids and raw base units for asks.
 *
 */
export function getExpectedOutAmountRouter({
  uiLadder,
  side,
  takerFeeBps,
  inAmount,
}: {
  uiLadder: UiLadder;
  side: Side;
  takerFeeBps: number;
  inAmount: number;
}): number {
  if (side == Side.Bid) {
    // If you are buying, then you expect to put in quote units and get raw base units out.
    return getRawBaseUnitsOutFromQuoteUnitsIn({
      uiLadder,
      takerFeeBps,
      quoteUnitsIn: inAmount,
    });
  } else {
    // If you are selling, then you expect to put in raw base units and get quote units out.
    return getQuoteUnitsOutFromRawBaseUnitsIn({
      uiLadder,
      takerFeeBps,
      rawBaseUnitsIn: inAmount,
    });
  }
}

/**
 * Given a side and a desired amount out, returns the amount in that would be required to get the desired amount out.
 *
 * @param uiLadder The uiLadder for the market. Note that prices in the uiLadder are in quote units per raw base unit (units of USDC per unit of SOL for the SOL/USDC market).
 * @param side The side of the order
 * @param takerFeeBps The taker fee in bps
 * @param outAmount The amount of the output token. Output amounts are in raw base units for bids and quote units for asks.
 *
 */
export function getRequiredInAmountRouter({
  uiLadder,
  side,
  takerFeeBps,
  outAmount,
}: {
  uiLadder: UiLadder;
  side: Side;
  takerFeeBps: number;
  outAmount: number;
}): number {
  if (side == Side.Bid) {
    // If you are buying, then you expect to put in quote units and get raw base units out.
    return getQuoteUnitsInFromRawBaseUnitsOut({
      uiLadder,
      takerFeeBps,
      rawBaseUnitsOut: outAmount,
    });
  } else {
    // If you are selling, then you expect to put in raw base units and get quote units out.
    return getRawBaseUnitsInFromQuoteUnitsOut({
      uiLadder,
      takerFeeBps,
      quoteUnitsOut: outAmount,
    });
  }
}

/**
 * Given an amount of quote units to spend, return the number of raw base units that will be received.
 * This function represents a Buy order where the caller knows the amount of quote tokens they are willing to spend and wants to know how many raw base units they can receive.
 *
 * @param uiLadder The uiLadder for the market. Note that prices in the uiLadder are in quote units per raw base unit (units of USDC per unit of SOL for the SOL/USDC market).
 * @param takerFeeBps The taker fee in bps
 * @param quoteUnitsIn The amount of quote units to spend to buy the base token
 *
 */
export function getRawBaseUnitsOutFromQuoteUnitsIn({
  uiLadder,
  takerFeeBps,
  quoteUnitsIn,
}: {
  uiLadder: UiLadder;
  takerFeeBps: number;
  quoteUnitsIn: number;
}): number {
  return getBaseAmountFromQuoteAmountBudgetAndBook({
    sideOfBook: uiLadder.asks,
    quoteAmountBudget: quoteUnitsIn / (1 + takerFeeBps / 10000),
  });
}

/**
 * Given an amount of raw base units to sell, return the number of quote units that will be received.
 * This function represents a Sell order where the caller knows the amount of raw base units they are willing to sell and wants to know how many raw base units they can receive.
 *
 * @param uiLadder The uiLadder for the market. Note that prices in the uiLadder are in quote units per raw base unit (units of USDC per unit of SOL for the SOL/USDC market).
 * @param takerFeeBps The taker fee in bps
 * @param rawBaseUnitsIn The amount of raw base units to sell
 *
 */
export function getQuoteUnitsOutFromRawBaseUnitsIn({
  uiLadder,
  takerFeeBps,
  rawBaseUnitsIn,
}: {
  uiLadder: UiLadder;
  takerFeeBps: number;
  rawBaseUnitsIn: number;
}): number {
  const quoteUnitsMatched = getQuoteAmountFromBaseAmountBudgetAndBook({
    sideOfBook: uiLadder.bids,
    baseAmountBudget: rawBaseUnitsIn,
  });

  return quoteUnitsMatched * (1 - takerFeeBps / 10000);
}

/**
 * Given a desired amount of quote units to obtain, return the number of raw base units that need to be sold to get that amount of quote units.
 * This function represents a Sell order where the caller knows the amount of quote units they want to obtain and wants to know how many raw base units they need to sell in order to obtain that amount of quote units.
 *
 * @param uiLadder The uiLadder for the market. Note that prices in the uiLadder are in quote units per raw base unit (units of USDC per unit of SOL for the SOL/USDC market).
 * @param takerFeeBps The taker fee in bps
 * @param quoteUnitsOut The amount of quote units to obtain
 *
 */
export function getRawBaseUnitsInFromQuoteUnitsOut({
  uiLadder,
  takerFeeBps,
  quoteUnitsOut,
}: {
  uiLadder: UiLadder;
  takerFeeBps: number;
  quoteUnitsOut: number;
}): number {
  return getBaseAmountFromQuoteAmountBudgetAndBook({
    sideOfBook: uiLadder.bids,
    quoteAmountBudget: quoteUnitsOut / (1 - takerFeeBps / 10000),
  });
}

/**
 * Given a desired amount of raw base units to obtain, return the number of quote units that need to be spent to get that amount of raw base units.
 * This function represents a Buy order where the caller knows the amount of raw base units they want to obtain but does not know how many quote units they need to spend in order to obtain that amount of raw base units.
 *
 * @param uiLadder The uiLadder for the market. Note that prices in the uiLadder are in quote units per raw base unit (units of USDC per unit of SOL for the SOL/USDC market).
 * @param takerFeeBps The taker fee in bps
 * @param rawBaseUnitsOut The amount of raw base units to obtain
 *
 */
export function getQuoteUnitsInFromRawBaseUnitsOut({
  uiLadder,
  takerFeeBps,
  rawBaseUnitsOut,
}: {
  uiLadder: UiLadder;
  takerFeeBps: number;
  rawBaseUnitsOut: number;
}): number {
  // Walk through the asks first and find quote units to match
  const quoteUnitsToMatch = getQuoteAmountFromBaseAmountBudgetAndBook({
    sideOfBook: uiLadder.asks,
    baseAmountBudget: rawBaseUnitsOut,
  });
  // Amount for quote units should account for fee
  return quoteUnitsToMatch * (1 + takerFeeBps / 10000);
}

/**
 * Given a budget of quote units in, return the number of raw base units that can be matched.
 *
 * @param sideOfBook The side of the book to match against. If the order is a buy order, then the sideOfBook input is the asks array. If the order is a sell order, then the sideOfBook input is the bids array.
 * @param quoteAmountBudget The amount of quote units to match with.
 *
 */
export function getBaseAmountFromQuoteAmountBudgetAndBook({
  sideOfBook,
  quoteAmountBudget,
}: {
  sideOfBook: UiLadderLevel[];
  quoteAmountBudget: number;
}): number {
  // Number returned is raw base units
  let quoteAmountBudgetRemaining = quoteAmountBudget;
  let baseAmount = 0;
  for (const {
    price: priceInQuoteUnitsPerRawBaseUnit,
    quantity: sizeInRawBaseUnits,
  } of sideOfBook) {
    if (
      priceInQuoteUnitsPerRawBaseUnit * sizeInRawBaseUnits >=
      quoteAmountBudgetRemaining
    ) {
      baseAmount +=
        quoteAmountBudgetRemaining / priceInQuoteUnitsPerRawBaseUnit;
      quoteAmountBudgetRemaining = 0;
      break;
    } else {
      baseAmount += sizeInRawBaseUnits;
      quoteAmountBudgetRemaining -=
        priceInQuoteUnitsPerRawBaseUnit * sizeInRawBaseUnits;
    }
  }
  return baseAmount;
}

/**
 * Given a budget of raw base units in, return the number of quote units that can be matched.
 *
 * @param sideOfBook The side of the book to match against. If the order is a buy order, then the sideOfBook input is the asks array. If the order is a sell order, then the sideOfBook input is the bids array.
 * @param baseAmountBudget The amount of raw base units to match with.
 *
 */
export function getQuoteAmountFromBaseAmountBudgetAndBook({
  sideOfBook,
  baseAmountBudget,
}: {
  sideOfBook: UiLadderLevel[];
  baseAmountBudget: number;
}): number {
  let baseAmountBudgetRemaining = baseAmountBudget;
  let quoteAmount = 0;
  for (const {
    price: priceInQuoteUnitsPerRawBaseUnit,
    quantity: sizeInRawBaseUnits,
  } of sideOfBook) {
    if (sizeInRawBaseUnits >= baseAmountBudgetRemaining) {
      quoteAmount +=
        baseAmountBudgetRemaining * priceInQuoteUnitsPerRawBaseUnit;
      baseAmountBudgetRemaining = 0;
      break;
    } else {
      quoteAmount += sizeInRawBaseUnits * priceInQuoteUnitsPerRawBaseUnit;
      baseAmountBudgetRemaining -= sizeInRawBaseUnits;
    }
  }
  return quoteAmount;
}

/**
 * Returns instructions for setting up a new maker on a market. Includes:
 * - create associated token accounts for base and quote tokens if needed
 * - create a claim seat instruction if needed, including performing a seat eviction if the market's trader state is full.
 * @param connection An instance of the Connection class
 * @param market The market object
 * @param trader The trader's address
 * @returns
 */
export async function getMakerSetupInstructionsForMarket(
  connection: Connection,
  market: Market,
  trader: PublicKey
): Promise<TransactionInstruction[]> {
  const baseAtaIxs = await getCreateTokenAccountInstructions(
    connection,
    trader,
    trader,
    market.data.header.baseParams.mintKey
  );
  const quoteAtaIxs = await getCreateTokenAccountInstructions(
    connection,
    trader,
    trader,
    market.data.header.quoteParams.mintKey
  );
  const claimSeatIxs = await confirmOrCreateClaimSeatIxs(
    connection,
    market,
    trader
  );

  return [...baseAtaIxs, ...quoteAtaIxs, ...claimSeatIxs];
}

/**
 * Return all instructions necessary to place a limit order on a market, including
 * - checking for and creating ATAs, if they do not exist
 * - checking for and claiming a seat, if trader does not have a seat on the market
 * - instruction for placing the limit order itself
 * Useful if unknown whether trader has the correct ATAs and seat initialized
 * @param connection An instance of the Connection class
 * @param market A market object
 * @param trader The trader's address
 * @param orderPacket The order packet to place
 * @returns
 */
export async function getLimitOrderNewMakerIxs(
  connection: Connection,
  market: Market,
  trader: PublicKey,
  orderPacket: OrderPacket
): Promise<TransactionInstruction[]> {
  const instructions: TransactionInstruction[] =
    await getMakerSetupInstructionsForMarket(connection, market, trader);
  instructions.push(
    market.createPlaceLimitOrderInstruction(orderPacket, trader)
  );

  return instructions;
}

/**
 * Returns instructions for claiming a seat on a market and placing a limit order
 * Useful if the caller is uncertain whether the trader has been evicted from the market, but knows the trader has ATAs
 * @param connection An instance of the Connection class
 * @param market The market object
 * @param trader The trader's address
 * @param orderPacket The order packet to place
 * @returns
 */
export async function getLimitOrderUnknownSeatIxs(
  connection: Connection,
  market: Market,
  trader: PublicKey,
  orderPacket: OrderPacket
): Promise<TransactionInstruction[]> {
  const instructions: TransactionInstruction[] = [];

  const claimSeatIxs = await confirmOrCreateClaimSeatIxs(
    connection,
    market,
    trader
  );
  instructions.push(...claimSeatIxs);
  instructions.push(
    market.createPlaceLimitOrderInstruction(orderPacket, trader)
  );

  return instructions;
}
