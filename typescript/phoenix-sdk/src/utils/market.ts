import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey, Transaction } from "@solana/web3.js";
import BN from "bn.js";
import * as beet from "@metaplex-foundation/beet";

import {
  marketHeaderBeet,
  OrderPacket,
  SelfTradeBehavior,
  Side,
} from "../types";
import { createSwapInstruction } from "../instructions";
import { sign, toBN, toNum } from "./numbers";
import {
  orderIdBeet,
  publicKeyBeet,
  restingOrderBeet,
  traderStateBeet,
} from "./beet";
import { PROGRAM_ID } from "..";
import { Ladder, UiLadder, MarketData, TraderState } from "../market";

export const DEFAULT_LADDER_DEPTH = 10;
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
  const collectedAdjustedQuoteLotFees = Number(
    remaining.readBigUInt64LE(offset)
  );
  offset += 8;
  const unclaimedAdjustedQuoteLotFees = Number(
    remaining.readBigUInt64LE(offset)
  );
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

  // TODO: Respect price-time ordering
  const bids = [...bidsUnsorted].sort((a, b) =>
    sign(toBN(b[0].priceInTicks).sub(toBN(a[0].priceInTicks)))
  );

  // TODO: Respect price-time ordering
  const asks = [...asksUnsorted].sort((a, b) =>
    sign(toBN(a[0].priceInTicks).sub(toBN(b[0].priceInTicks)))
  );

  const traders = new Map<string, TraderState>();
  for (const [k, traderState] of deserializeRedBlackTree(
    traderBuffer,
    publicKeyBeet,
    traderStateBeet
  )) {
    traders.set(k.publicKey.toString(), traderState);
  }

  const traderIndex = new Map<string, number>();
  for (const [k, index] of getNodeIndices(
    traderBuffer,
    publicKeyBeet,
    traderStateBeet
  )) {
    traderIndex.set(k.publicKey.toString(), index);
  }

  return {
    header,
    baseLotsPerBaseUnit,
    quoteLotsPerBaseUnitPerTick,
    sequenceNumber,
    takerFeeBps,
    collectedAdjustedQuoteLotFees,
    unclaimedAdjustedQuoteLotFees,
    bids,
    asks,
    traders,
    traderIndex,
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
export function deserializeRedBlackTree<Key, Value>(
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
export function getNodeIndices<Key, Value>(
  data: Buffer,
  keyDeserializer: beet.BeetArgsStruct<Key>,
  valueDeserializer: beet.BeetArgsStruct<Value>
): Map<Key, number> {
  const index_map = new Map<Key, number>();
  const tree_nodes = deserializeRedBlackTreeNodes(
    data,
    keyDeserializer,
    valueDeserializer
  );

  const nodes = tree_nodes[0];
  const freeNodes = tree_nodes[1];

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for (const [index, [key, _]] of nodes.entries()) {
    if (!freeNodes.has(index)) {
      index_map.set(key, index + 1);
    }
  }

  return index_map;
}

/**
 * Deserializes a RedBlackTree from a given buffer and returns the nodes and free nodes
 * @description This deserialized the RedBlackTree defined in the sokoban library: https://github.com/Ellipsis-Labs/sokoban/tree/master
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
 * Returns a ladder of bids and asks for given `MarketData`
 * @description Bids are ordered in descending order by price, and asks are ordered in ascending order by price
 *
 * @param marketData The `MarketData` to get the ladder from
 * @param levels The number of book levels to return, -1 to return the entire book
 */
export function getMarketLadder(
  marketData: MarketData,
  slot: beet.bignum,
  unixTimestamp: beet.bignum,
  levels: number = DEFAULT_LADDER_DEPTH
): Ladder {
  const bids: Array<[BN, BN]> = [];
  const asks: Array<[BN, BN]> = [];
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
    const numBaseLots = toBN(restingOrder.numBaseLots);
    if (bids.length === 0) {
      bids.push([priceInTicks, numBaseLots]);
    } else {
      const prev = bids[bids.length - 1];
      if (!prev) {
        throw Error;
      }
      if (priceInTicks.eq(prev[0])) {
        prev[1] = prev[1].add(numBaseLots);
      } else {
        if (bids.length === levels) {
          break;
        }
        bids.push([priceInTicks, numBaseLots]);
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
    const numBaseLots = toBN(restingOrder.numBaseLots);
    if (asks.length === 0) {
      asks.push([priceInTicks, numBaseLots]);
    } else {
      const prev = asks[asks.length - 1];
      if (!prev) {
        throw Error;
      }
      if (priceInTicks.eq(prev[0])) {
        prev[1] = prev[1].add(numBaseLots);
      } else {
        if (asks.length === levels) {
          break;
        }
        asks.push([priceInTicks, numBaseLots]);
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
    (toNum(priceInTicks) / quoteAtomsPerQuoteUnit) *
      marketData.quoteLotsPerBaseUnitPerTick *
      toNum(marketData.header.quoteLotSize),
    toNum(sizeInBaseLots) / marketData.baseLotsPerBaseUnit,
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
  levels: number = DEFAULT_LADDER_DEPTH,
  slot: beet.bignum = 0,
  unixTimestamp: beet.bignum = 0
): UiLadder {
  const ladder = getMarketLadder(marketData, slot, unixTimestamp, levels);

  const quoteAtomsPerQuoteUnit =
    10 ** toNum(marketData.header.quoteParams.decimals);
  return {
    bids: ladder.bids.map(([priceInTicks, sizeInBaseLots]) =>
      levelToUiLevel(
        marketData,
        priceInTicks,
        sizeInBaseLots,
        quoteAtomsPerQuoteUnit
      )
    ),
    asks: ladder.asks.map(([priceInTicks, sizeInBaseLots]) =>
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
 * Returns a Phoenix swap transaction
 *
 * @param marketAddress The address of the market to swap in
 * @param marketData The `MarketData` for the swap market
 * @param trader The `PublicKey` of the trader
 * @param side The side of the order to place (Bid, Ask)
 * @param inAmount The amount (in whole tokens) of the input token to swap
 * @param slippage The slippage tolerance (optional, default 0.5%)
 * @param clientOrderId The client order ID (optional)
 */
export function getMarketSwapTransaction({
  marketAddress,
  marketData,
  trader,
  side,
  inAmount,
  slippage = DEFAULT_SLIPPAGE_PERCENT,
  clientOrderId = 0,
}: {
  marketAddress: PublicKey;
  marketData: MarketData;
  trader: PublicKey;
  side: Side;
  inAmount: number;
  slippage?: number;
  clientOrderId?: number;
}): Transaction {
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

  const orderPacket = getMarketSwapOrderPacket({
    marketData,
    side,
    inAmount,
    slippage,
    clientOrderId,
  });

  const ix = createSwapInstruction(orderAccounts, {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore TODO why is __kind incompatible?
    orderPacket: {
      __kind: "ImmediateOrCancel",
      ...orderPacket,
    },
  });

  return new Transaction().add(ix);
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
  const ladder = getMarketUiLadder(this.data, Math.max(numBids, numAsks));
  const expectedOutAmount = getMarketExpectedOutAmount({
    ladder,
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
  };

  return orderPacket;
}

/**
 * Returns the expected amount out for a given swap order
 *
 * @param marketData The `MarketData` for the swap market
 * @param side The side of the order (Bid or Ask)
 * @param inAmount The amount of the input token
 *
 * TODO this should use getMarketLadder and adjust its calculation
 */
export function getMarketExpectedOutAmount({
  ladder,
  takerFeeBps,
  side,
  inAmount,
}: {
  ladder: UiLadder;
  takerFeeBps: number;
  side: Side;
  inAmount: number;
}): number {
  let remainingUnits = inAmount * (1 - takerFeeBps / 10000);
  let expectedUnitsReceived = 0;
  if (side === Side.Bid) {
    for (const [priceInQuoteUnitsPerBaseUnit, sizeInBaseUnits] of ladder.asks) {
      const totalQuoteUnitsAvailable =
        sizeInBaseUnits * priceInQuoteUnitsPerBaseUnit;
      if (totalQuoteUnitsAvailable > remainingUnits) {
        expectedUnitsReceived += remainingUnits / priceInQuoteUnitsPerBaseUnit;
        remainingUnits = 0;
        break;
      } else {
        expectedUnitsReceived += sizeInBaseUnits;
        remainingUnits -= totalQuoteUnitsAvailable;
      }
    }
  } else {
    for (const [priceInQuoteUnitsPerBaseUnit, sizeInBaseUnits] of ladder.bids) {
      if (sizeInBaseUnits > remainingUnits) {
        expectedUnitsReceived += remainingUnits * priceInQuoteUnitsPerBaseUnit;
        remainingUnits = 0;
        break;
      } else {
        expectedUnitsReceived += sizeInBaseUnits * priceInQuoteUnitsPerBaseUnit;
        remainingUnits -= sizeInBaseUnits;
      }
    }
  }

  return expectedUnitsReceived;
}
