import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import BN from "bn.js";
import * as beet from "@metaplex-foundation/beet";

import {
  marketHeaderBeet,
  OrderPacket,
  SelfTradeBehavior,
  Side,
} from "../types";
import {
  createSwapInstruction,
  createPlaceLimitOrderInstruction,
  PlaceLimitOrderInstructionArgs,
  PlaceLimitOrderInstructionAccounts,
} from "../instructions";
import { sign, toBN, toNum } from "./numbers";
import {
  orderIdBeet,
  publicKeyBeet,
  restingOrderBeet,
  traderStateBeet,
} from "./beet";
import {
  Client,
  L3Book,
  L3Order,
  L3UiBook,
  L3UiOrder,
  LadderLevel,
  OrderId,
  PROGRAM_ID,
} from "..";
import { Ladder, UiLadder, MarketData, TraderState } from "../market";
import { getCreateTokenAccountInstructions } from "./token";

import { confirmOrCreateClaimSeatIxs } from "./seatManager";
import {
  LimitOrderTemplate,
  PostOnlyOrderTemplate,
  ImmediateOrCancelOrderTemplate,
} from "orderPacketTemplate";

// Default ladder depth to use when fetching L2 ladder
export const DEFAULT_L2_LADDER_DEPTH = 10;

// Default book depth tho use when fetching L3 book
export const DEFAULT_L3_BOOK_DEPTH = 20;

export const DEFAULT_MATCH_LIMIT = 2048;
export const DEFAULT_SLIPPAGE_PERCENT = 0.005;

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
 * @param marketData The `MarketData` to get the ladder from
 * @param slot The current slot
 * @param unixTimestamp The current Unix timestamp, in seconds
 * @param levels The number of book levels to return, -1 to return the entire book
 */
export function getMarketLadder(
  marketData: MarketData,
  slot: beet.bignum,
  unixTimestamp: beet.bignum,
  levels: number = DEFAULT_L2_LADDER_DEPTH
): Ladder {
  const bids: Array<LadderLevel> = [];
  const asks: Array<LadderLevel> = [];
  for (const [orderId, restingOrder] of marketData.bids) {
    if (restingOrder.lastValidSlot != 0 && restingOrder.lastValidSlot < slot) {
      continue;
    }
    if (
      restingOrder.lastValidUnixTimestampInSeconds != 0 &&
      restingOrder.lastValidUnixTimestampInSeconds < unixTimestamp
    ) {
      continue;
    }
    const priceInTicks = toBN(orderId.priceInTicks);
    const sizeInBaseLots = toBN(restingOrder.numBaseLots);
    if (bids.length === 0) {
      bids.push({ priceInTicks, sizeInBaseLots });
    } else {
      const prev = bids[bids.length - 1];
      if (!prev) {
        throw Error;
      }
      if (priceInTicks.eq(prev[0])) {
        prev[1] = prev[1].add(sizeInBaseLots);
      } else {
        if (bids.length === levels) {
          break;
        }
        bids.push({ priceInTicks, sizeInBaseLots });
      }
    }
  }

  for (const [orderId, restingOrder] of marketData.asks) {
    if (restingOrder.lastValidSlot != 0 && restingOrder.lastValidSlot < slot) {
      continue;
    }
    if (
      restingOrder.lastValidUnixTimestampInSeconds != 0 &&
      restingOrder.lastValidUnixTimestampInSeconds < unixTimestamp
    ) {
      continue;
    }
    const priceInTicks = toBN(orderId.priceInTicks);
    const sizeInBaseLots = toBN(restingOrder.numBaseLots);
    if (asks.length === 0) {
      asks.push({ priceInTicks, sizeInBaseLots });
    } else {
      const prev = asks[asks.length - 1];
      if (!prev) {
        throw Error;
      }
      if (priceInTicks.eq(prev[0])) {
        prev[1] = prev[1].add(sizeInBaseLots);
      } else {
        if (asks.length === levels) {
          break;
        }
        asks.push({ priceInTicks, sizeInBaseLots });
      }
    }
  }

  return {
    asks,
    bids,
  };
}

/**
 * Converts a ladder level from BN to JS number representation
 *
 * @param marketData The `MarketData` the ladder was taken from
 * @param priceInTicks The price of the level in ticks
 * @param sizeInBaseLots The size of the level in base lots
 * @param quoteAtomsPerQuoteUnit The number of quote atoms per quote unit
 */
function levelToUiLevel(
  marketData: MarketData,
  priceInTicks: BN,
  sizeInBaseLots: BN,
  quoteAtomsPerQuoteUnit: number
): [number, number] {
  return [
    ((toNum(priceInTicks) / quoteAtomsPerQuoteUnit) *
      marketData.quoteLotsPerBaseUnitPerTick *
      toNum(marketData.header.quoteLotSize)) /
      marketData.header.rawBaseUnitsPerBaseUnit,
    (toNum(sizeInBaseLots) / marketData.baseLotsPerBaseUnit) *
      marketData.header.rawBaseUnitsPerBaseUnit,
  ];
}

/**
 * Returns the ladder of bids and asks as JS numbers for given `MarketData`
 *
 * @param marketData The `MarketData` to get the ladder from
 * @param levels The number of book levels to return
 */
export function getMarketUiLadder(
  marketData: MarketData,
  levels: number = DEFAULT_L2_LADDER_DEPTH,
  slot: beet.bignum = 0,
  unixTimestamp: beet.bignum = 0
): UiLadder {
  const ladder = getMarketLadder(marketData, slot, unixTimestamp, levels);

  const quoteAtomsPerQuoteUnit =
    10 ** toNum(marketData.header.quoteParams.decimals);
  return {
    bids: ladder.bids.map(({ priceInTicks, sizeInBaseLots }) =>
      levelToUiLevel(
        marketData,
        priceInTicks,
        sizeInBaseLots,
        quoteAtomsPerQuoteUnit
      )
    ),
    asks: ladder.asks.map(({ priceInTicks, sizeInBaseLots }) =>
      levelToUiLevel(
        marketData,
        priceInTicks,
        sizeInBaseLots,
        quoteAtomsPerQuoteUnit
      )
    ),
  };
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
  for (const [price, size] of asks.reverse()) {
    printLine(price, size, "red");
  }

  console.log("\u001b[30mBids\u001b[0m");
  for (const [price, size] of bids) {
    printLine(price, size, "green");
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
  };
}

/**
 * Returns a Phoenix swap transaction
 *
 * @param marketAddress The address of the market to swap in
 * @param marketData The `MarketData` for the swap market
 * @param trader The `PublicKey` of the trader
 * @param side The side of the order to place (Bid, Ask)
 * @param inAmount The amount (in whole tokens) of the input token to swap
 * @param slippage The slippage tolerance (optional, default 0.5%)
 * @param clientOrderId The client order ID (optional)
 * @param idempotent If set to true, the transaction will idempotently create both mint accounts (optional, default false)
 */
export function getMarketSwapTransaction({
  marketAddress,
  marketData,
  trader,
  side,
  inAmount,
  slippage = DEFAULT_SLIPPAGE_PERCENT,
  clientOrderId = 0,
  idempotent = false,
}: {
  marketAddress: PublicKey;
  marketData: MarketData;
  trader: PublicKey;
  side: Side;
  inAmount: number;
  slippage?: number;
  clientOrderId?: number;
  idempotent?: boolean;
}): Transaction {
  const quoteMintKey = marketData.header.quoteParams.mintKey;
  const baseMintKey = marketData.header.baseParams.mintKey;

  const [baseTokenAccountKey] = PublicKey.findProgramAddressSync(
    [trader.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), baseMintKey.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  const [quoteTokenAccountKey] = PublicKey.findProgramAddressSync(
    [trader.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), quoteMintKey.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const logAuthority = PublicKey.findProgramAddressSync(
    [Buffer.from("log")],
    PROGRAM_ID
  )[0];

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

  const orderAccounts = {
    phoenixProgram: PROGRAM_ID,
    logAuthority,
    market: marketAddress,
    trader,
    baseAccount: baseTokenAccountKey,
    quoteAccount: quoteTokenAccountKey,
    quoteVault: marketData.header.quoteParams.vaultKey,
    baseVault: marketData.header.baseParams.vaultKey,
  };

  const orderPacket = getMarketSwapOrderPacket({
    marketData,
    side,
    inAmount,
    slippage,
    clientOrderId,
  });

  const swapInstruction = createSwapInstruction(orderAccounts, {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore TODO why is __kind incompatible?
    orderPacket: {
      __kind: "ImmediateOrCancel",
      ...orderPacket,
    },
  });

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
 * Returns a Phoenix swap order packet
 *
 * @param marketData The `MarketData` for the swap market
 * @param side The side of the order
 * @param inAmount The amount of the input token
 * @param slippage The slippage tolerance in bps (optional, default 0.5%)
 * @param selfTradeBehavior The self trade behavior (optional, default Abort)
 * @param matchLimit The match limit (optional)
 * @param clientOrderId The client order ID (optional)
 * @param useOnlyDepositedFunds Whether to use only deposited funds (optional)
 */
export function getMarketSwapOrderPacket({
  marketData,
  side,
  inAmount,
  slippage = DEFAULT_SLIPPAGE_PERCENT,
  selfTradeBehavior = SelfTradeBehavior.Abort,
  matchLimit = DEFAULT_MATCH_LIMIT,
  clientOrderId = 0,
  useOnlyDepositedFunds = false,
}: {
  marketData: MarketData;
  side: Side;
  inAmount: number;
  slippage?: number;
  selfTradeBehavior?: SelfTradeBehavior;
  matchLimit?: number;
  clientOrderId?: number;
  useOnlyDepositedFunds?: boolean;
}): Partial<OrderPacket> {
  const numBids = toNum(marketData.header.marketSizeParams.bidsSize);
  const numAsks = toNum(marketData.header.marketSizeParams.asksSize);
  const uiLadder = getMarketUiLadder(marketData, Math.max(numBids, numAsks));
  const expectedOutAmount = getExpectedOutAmountRouter({
    uiLadder,
    takerFeeBps: marketData.takerFeeBps,
    side,
    inAmount,
  });
  const baseMul = 10 ** marketData.header.baseParams.decimals;
  const quoteMul = 10 ** marketData.header.quoteParams.decimals;
  const slippageDenom = 1 - slippage;
  let numBaseLots = 0;
  let minBaseLotsToFill = 0;
  let numQuoteLots = 0;
  let minQuoteLotsToFill = 0;

  if (side === Side.Ask) {
    numBaseLots =
      (inAmount * baseMul) /
      parseFloat(marketData.header.baseLotSize.toString());
    minQuoteLotsToFill = Math.ceil(
      ((expectedOutAmount * quoteMul) /
        parseFloat(marketData.header.quoteLotSize.toString())) *
        slippageDenom
    );
  } else {
    numQuoteLots =
      (inAmount * quoteMul) /
      parseFloat(marketData.header.quoteLotSize.toString());
    minBaseLotsToFill = Math.ceil(
      ((expectedOutAmount * baseMul) /
        parseFloat(marketData.header.baseLotSize.toString())) *
        slippageDenom
    );
  }

  const orderPacket: Partial<OrderPacket> = {
    side,
    priceInTicks: null,
    numBaseLots,
    minBaseLotsToFill,
    numQuoteLots,
    minQuoteLotsToFill,
    selfTradeBehavior,
    matchLimit,
    clientOrderId,
    useOnlyDepositedFunds,
    lastValidSlot: null,
    lastValidUnixTimestampInSeconds: null,
  };

  return orderPacket;
}

/**
 * Returns a Phoenix swap order packet
 *
 * @param marketData The `MarketData` for the swap market
 * @param side The side of the order
 * @param inAmount The amount of the input token
 * @param lastValidSlot The last valid slot for the order, if null, the order is valid until cancelled
 * @param lastValidUnixTimestampInSeconds The last valid unix timestamp in seconds for the order, if null, the order is valid until cancelled
 * @param slippage The slippage tolerance in bps (optional, default 0.5%)
 * @param selfTradeBehavior The self trade behavior (optional, default Abort)
 * @param matchLimit The match limit (optional)
 * @param clientOrderId The client order ID (optional)
 * @param useOnlyDepositedFunds Whether to use only deposited funds (optional)
 */
export function getMarketSwapOrderPacketWithTimeInForce({
  marketData,
  side,
  inAmount,
  lastValidSlot,
  lastValidUnixTimestampInSeconds,
  slippage = DEFAULT_SLIPPAGE_PERCENT,
  selfTradeBehavior = SelfTradeBehavior.Abort,
  matchLimit = DEFAULT_MATCH_LIMIT,
  clientOrderId = 0,
  useOnlyDepositedFunds = false,
}: {
  marketData: MarketData;
  side: Side;
  inAmount: number;
  lastValidSlot: number | null;
  lastValidUnixTimestampInSeconds: number | null;
  slippage?: number;
  selfTradeBehavior?: SelfTradeBehavior;
  matchLimit?: number;
  clientOrderId?: number;
  useOnlyDepositedFunds?: boolean;
}): Partial<OrderPacket> {
  const orderPacket = getMarketSwapOrderPacket({
    marketData,
    side,
    inAmount,
    slippage,
    selfTradeBehavior,
    matchLimit,
    clientOrderId,
    useOnlyDepositedFunds,
  });
  orderPacket.lastValidSlot = lastValidSlot;
  orderPacket.lastValidUnixTimestampInSeconds = lastValidUnixTimestampInSeconds;
  return orderPacket;
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
  sideOfBook: [number, number][];
  quoteAmountBudget: number;
}): number {
  // Number returned is raw base units
  let quoteAmountBudgetRemaining = quoteAmountBudget;
  let baseAmount = 0;
  for (const [
    priceInQuoteUnitsPerRawBaseUnit,
    sizeInRawBaseUnits,
  ] of sideOfBook) {
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
  sideOfBook: [number, number][];
  baseAmountBudget: number;
}): number {
  let baseAmountBudgetRemaining = baseAmountBudget;
  let quoteAmount = 0;
  for (const [
    priceInQuoteUnitsPerRawBaseUnit,
    sizeInRawBaseUnits,
  ] of sideOfBook) {
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
 * Get the log authority's address
 */
export function getLogAuthorityAddress(): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("log")], PROGRAM_ID)[0];
}

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
 * Returns an instruction to place a limit order on a market
 * Does not check for existence of associated token accounts or seat (no network calls)
 * Should be used to place limit orders after it's confirmed that the maker has ATAs and a seat on the market
 * @param market The market's address
 * @param marketData The market's data, containing base and quote mint information
 * @param trader The trader's address
 * @param orderPacket The order packet to place
 */
export function getLimitOrderIx(
  market: PublicKey,
  marketData: MarketData,
  trader: PublicKey,
  orderPacket: OrderPacket
): TransactionInstruction {
  const seat = getSeatAddress(market, trader);
  const logAuthority = getLogAuthorityAddress();

  const baseAccount = PublicKey.findProgramAddressSync(
    [
      trader.toBuffer(),
      TOKEN_PROGRAM_ID.toBuffer(),
      marketData.header.baseParams.mintKey.toBuffer(),
    ],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];
  const quoteAccount = PublicKey.findProgramAddressSync(
    [
      trader.toBuffer(),
      TOKEN_PROGRAM_ID.toBuffer(),
      marketData.header.quoteParams.mintKey.toBuffer(),
    ],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];

  const limitOrderAccounts: PlaceLimitOrderInstructionAccounts = {
    phoenixProgram: PROGRAM_ID,
    logAuthority,
    market,
    trader,
    seat,
    baseAccount,
    quoteAccount,
    baseVault: marketData.header.baseParams.vaultKey,
    quoteVault: marketData.header.quoteParams.vaultKey,
  };

  const args: PlaceLimitOrderInstructionArgs = {
    orderPacket,
  };

  return createPlaceLimitOrderInstruction(limitOrderAccounts, args);
}
/**
 * Returns an instruction to place a limit order on a market, using a LimitOrderPacketTemplate, which takes in human-friendly units
 * @param client An instance of the Client class to use for converting units
 * @param market The market's address
 * @param marketData The market's data, containing base and quote mint information
 * @param trader The trader's address
 * @param limitOrderTemplate The order packet template to place
 * @returns
 */
export function getLimitOrderIxfromTemplate(
  client: Client,
  market: PublicKey,
  marketData: MarketData,
  trader: PublicKey,
  limitOrderTemplate: LimitOrderTemplate
): TransactionInstruction {
  const priceInTicks = client.floatPriceToTicks(
    limitOrderTemplate.priceAsFloat,
    market.toBase58()
  );
  const numBaseLots = client.rawBaseUnitsToBaseLotsRoundedDown(
    limitOrderTemplate.sizeInBaseUnits,
    market.toBase58()
  );

  const orderPacket = getLimitOrderPacket(
    limitOrderTemplate.side,
    priceInTicks,
    numBaseLots,
    limitOrderTemplate.selfTradeBehavior,
    limitOrderTemplate.matchLimit,
    limitOrderTemplate.clientOrderId,
    limitOrderTemplate.useOnlyDepositedFunds,
    limitOrderTemplate.lastValidSlot,
    limitOrderTemplate.lastValidUnixTimestampInSeconds
  );
  return getLimitOrderIx(market, marketData, trader, orderPacket);
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
export function getLimitOrderPacket(
  side: Side,
  priceInTicks: number,
  numBaseLots: number,
  selfTradeBehavior?: SelfTradeBehavior,
  matchLimit?: beet.COption<beet.bignum>,
  clientOrderId?: number,
  useOnlyDepositedFunds?: boolean,
  lastValidSlot?: beet.COption<beet.bignum>,
  lastValidUnixTimestampInSeconds?: beet.COption<beet.bignum>
): OrderPacket {
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
 * Returns instructions for setting up a new maker on a market. Includes:
 * - create associated token accounts for base and quote tokens if needed
 * - create a claim seat instruction if needed, including performing a seat eviction if the market's trader state is full.
 * @param client An instance of the Client class
 * @param market The market's address
 * @param marketData The market's data, containing base and quote mint information
 * @param trader The trader's address
 * @returns
 */
export async function getMakerSetupInstructionsForMarket(
  client: Client,
  market: PublicKey,
  marketData: MarketData,
  trader: PublicKey
): Promise<TransactionInstruction[]> {
  const baseAtaIxs = await getCreateTokenAccountInstructions(
    client.connection,
    trader,
    trader,
    marketData.header.baseParams.mintKey
  );
  const quoteAtaIxs = await getCreateTokenAccountInstructions(
    client.connection,
    trader,
    trader,
    marketData.header.quoteParams.mintKey
  );
  const claimSeatIxs = await confirmOrCreateClaimSeatIxs(
    client,
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
 * @param client An instance of the Client class
 * @param market The market's address
 * @param marketData The market's data, containing base and quote mint information
 * @param trader The trader's address
 * @param orderPacket The order packet to place
 * @returns
 */
export async function getLimitOrderNewMakerIxs(
  client: Client,
  market: PublicKey,
  marketData: MarketData,
  trader: PublicKey,
  orderPacket: OrderPacket
): Promise<TransactionInstruction[]> {
  const instructions: TransactionInstruction[] =
    await getMakerSetupInstructionsForMarket(
      client,
      market,
      marketData,
      trader
    );
  instructions.push(getLimitOrderIx(market, marketData, trader, orderPacket));

  return instructions;
}

/**
 * Returns instructions for claiming a seat on a market and placing a limit order
 * Useful if the caller is uncertain whether the trader has been evicted from the market, but knows the trader has ATAs
 * @param client An instance of the Client class
 * @param market The market's address
 * @param marketData The market's data, containing base and quote mint information
 * @param trader The trader's address
 * @param orderPacket The order packet to place
 * @returns
 */
export async function getLimitOrderUnknownSeatIxs(
  client: Client,
  market: PublicKey,
  marketData: MarketData,
  trader: PublicKey,
  orderPacket: OrderPacket
): Promise<TransactionInstruction[]> {
  const instructions: TransactionInstruction[] = [];

  const claimSeatIxs = await confirmOrCreateClaimSeatIxs(
    client,
    market,
    trader
  );
  instructions.push(...claimSeatIxs);
  instructions.push(getLimitOrderIx(market, marketData, trader, orderPacket));

  return instructions;
}

/**
 * Returns an instruction to place a post only on a market, using a PostOnlyOrderPacketTemplate, which takes in human-friendly units.
 * @param client An instance of the Client class to use for converting units
 * @param market The market's address
 * @param marketData The market's data, containing base and quote mint information
 * @param trader The trader's address
 * @param postOnlyOrderTemplate The order packet template to place
 * @returns
 */
export function getPostOnlyOrderIxfromTemplate(
  client: Client,
  market: PublicKey,
  marketData: MarketData,
  trader: PublicKey,
  postOnlyOrderTemplate: PostOnlyOrderTemplate
): TransactionInstruction {
  const priceInTicks = client.floatPriceToTicks(
    postOnlyOrderTemplate.priceAsFloat,
    market.toBase58()
  );
  const numBaseLots = client.rawBaseUnitsToBaseLotsRoundedDown(
    postOnlyOrderTemplate.sizeInBaseUnits,
    market.toBase58()
  );

  const orderPacket = getPostOnlyOrderPacket(
    postOnlyOrderTemplate.side,
    priceInTicks,
    numBaseLots,
    postOnlyOrderTemplate.clientOrderId,
    postOnlyOrderTemplate.rejectPostOnly,
    postOnlyOrderTemplate.useOnlyDepositedFunds,
    postOnlyOrderTemplate.lastValidSlot,
    postOnlyOrderTemplate.lastValidUnixTimestampInSeconds
  );
  return getLimitOrderIx(market, marketData, trader, orderPacket);
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
export function getPostOnlyOrderPacket(
  side: Side,
  priceInTicks: number,
  numBaseLots: number,
  clientOrderId?: number,
  rejectPostOnly?: boolean,
  useOnlyDepositedFunds?: boolean,
  lastValidSlot?: beet.COption<beet.bignum>,
  lastValidUnixTimestampInSeconds?: beet.COption<beet.bignum>
): OrderPacket {
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
 * Returns an instruction to place an immediate or cancel on a market, using a ImmediateOrCancelPacketTemplate, which takes in human-friendly units.
 * @param client An instance of the Client class to use for converting units
 * @param market The market's address
 * @param marketData The market's data, containing base and quote mint information
 * @param trader The trader's address
 * @param ImmediateOrCancelOrderTemplate The order packet template to place
 * @returns
 */
export function getImmediateOrCancelOrderIxfromTemplate(
  client: Client,
  market: PublicKey,
  marketData: MarketData,
  trader: PublicKey,
  ImmediateOrCancelOrderTemplate: ImmediateOrCancelOrderTemplate
): TransactionInstruction {
  const priceInTicks = client.floatPriceToTicks(
    ImmediateOrCancelOrderTemplate.priceAsFloat,
    market.toBase58()
  );
  const numBaseLots = client.rawBaseUnitsToBaseLotsRoundedDown(
    ImmediateOrCancelOrderTemplate.sizeInBaseUnits,
    market.toBase58()
  );
  const numQuoteLots = client.quoteUnitsToQuoteLots(
    ImmediateOrCancelOrderTemplate.sizeInQuoteUnits,
    market.toBase58()
  );
  const minBaseLotsToFill = client.rawBaseUnitsToBaseLotsRoundedDown(
    ImmediateOrCancelOrderTemplate.minBaseUnitsToFill,
    market.toBase58()
  );
  const minQuoteLotsToFill = client.quoteUnitsToQuoteLots(
    ImmediateOrCancelOrderTemplate.minQuoteUnitsToFill,
    market.toBase58()
  );

  const orderPacket = getImmediateOrCancelOrderPacket(
    ImmediateOrCancelOrderTemplate.side,
    priceInTicks,
    numBaseLots,
    numQuoteLots,
    minBaseLotsToFill,
    minQuoteLotsToFill,
    ImmediateOrCancelOrderTemplate.selfTradeBehavior,
    ImmediateOrCancelOrderTemplate.matchLimit,
    ImmediateOrCancelOrderTemplate.clientOrderId,
    ImmediateOrCancelOrderTemplate.useOnlyDepositedFunds,
    ImmediateOrCancelOrderTemplate.lastValidSlot,
    ImmediateOrCancelOrderTemplate.lastValidUnixTimestampInSeconds
  );
  return getImmediateOrCancelOrderIx(market, marketData, trader, orderPacket);
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
export function getImmediateOrCancelOrderPacket(
  side: Side,
  priceInTicks: number,
  numBaseLots: number,
  numQuoteLots: number,
  minBaseLotsToFill: number,
  minQuoteLotsToFill: number,
  selfTradeBehavior?: SelfTradeBehavior,
  matchLimit?: beet.COption<beet.bignum>,
  clientOrderId?: number,
  useOnlyDepositedFunds?: boolean,
  lastValidSlot?: beet.COption<beet.bignum>,
  lastValidUnixTimestampInSeconds?: beet.COption<beet.bignum>
): OrderPacket {
  return {
    __kind: "ImmediateOrCancel",
    side,
    priceInTicks,
    numBaseLots,
    numQuoteLots,
    minBaseLotsToFill,
    minQuoteLotsToFill,
    selfTradeBehavior: selfTradeBehavior ?? SelfTradeBehavior.CancelProvide,
    matchLimit,
    clientOrderId: clientOrderId ?? 0,
    useOnlyDepositedFunds: useOnlyDepositedFunds ?? false,
    lastValidSlot,
    lastValidUnixTimestampInSeconds,
  };
}

/**
 * Returns a Phoenix swap transaction (an immediate-or-cancel order)
 *
 * @param marketAddress The address of the market to swap in
 * @param marketData The `MarketData` for the swap market
 * @param trader The `PublicKey` of the trader
 * @param orderPacket The OrderPacket to place
 */
export function getImmediateOrCancelOrderIx(
  marketAddress: PublicKey,
  marketData: MarketData,
  trader: PublicKey,
  orderPacket: OrderPacket
): TransactionInstruction {
  const baseAccount = PublicKey.findProgramAddressSync(
    [
      trader.toBuffer(),
      TOKEN_PROGRAM_ID.toBuffer(),
      marketData.header.baseParams.mintKey.toBuffer(),
    ],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];
  const quoteAccount = PublicKey.findProgramAddressSync(
    [
      trader.toBuffer(),
      TOKEN_PROGRAM_ID.toBuffer(),
      marketData.header.quoteParams.mintKey.toBuffer(),
    ],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];
  const logAuthority = PublicKey.findProgramAddressSync(
    [Buffer.from("log")],
    PROGRAM_ID
  )[0];

  const orderAccounts = {
    phoenixProgram: PROGRAM_ID,
    logAuthority,
    market: marketAddress,
    trader,
    baseAccount,
    quoteAccount,
    quoteVault: marketData.header.quoteParams.vaultKey,
    baseVault: marketData.header.baseParams.vaultKey,
  };

  return createSwapInstruction(orderAccounts, {
    orderPacket,
  });

  
}
