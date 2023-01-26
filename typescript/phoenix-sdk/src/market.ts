import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import * as beet from "@metaplex-foundation/beet";
import * as beetSolana from "@metaplex-foundation/beet-solana";
import BN from "bn.js";

import CONFIG from "../config.json";
import { PROGRAM_ID } from "./";
import {
  MarketHeader,
  marketHeaderBeet,
  OrderPacket,
  SelfTradeBehavior,
  Side,
} from "./types";
import { toNum, toBN } from "./utils";
import { createSwapInstruction } from "./instructions";
import { Token } from "./token";

export const DEFAULT_LADDER_DEPTH = 10;
export const DEFAULT_MATCH_LIMIT = 2048;
export const DEFAULT_SLIPPAGE_PERCENT = 0.005;

export type OrderId = {
  priceInTicks: beet.bignum;
  orderSequenceNumber: beet.bignum;
};

export const orderIdBeet = new beet.BeetArgsStruct<OrderId>(
  [
    ["priceInTicks", beet.u64],
    ["orderSequenceNumber", beet.u64],
  ],
  "fIFOOrderId"
);

export type RestingOrder = {
  traderIndex: beet.bignum;
  numBaseLots: beet.bignum;
};

export const restingOrderBeet = new beet.BeetArgsStruct<RestingOrder>(
  [
    ["traderIndex", beet.u64],
    ["numBaseLots", beet.u64],
  ],
  "fIFORestingOrder"
);

export type TraderState = {
  quoteLotsLocked: beet.bignum;
  quoteLotsFree: beet.bignum;
  baseLotsLocked: beet.bignum;
  baseLotsFree: beet.bignum;
};

export const traderStateBeet = new beet.BeetArgsStruct<TraderState>(
  [
    ["quoteLotsLocked", beet.u64],
    ["quoteLotsFree", beet.u64],
    ["baseLotsLocked", beet.u64],
    ["baseLotsFree", beet.u64],
  ],
  "TraderState"
);

const publicKeyBeet = new beet.BeetArgsStruct<{
  publicKey: PublicKey;
}>([["publicKey", beetSolana.publicKey]], "PubkeyWrapper");

export type Ladder = {
  bids: Array<[BN, BN]>;
  asks: Array<[BN, BN]>;
};
export type UiLadder = {
  bids: Array<[number, number]>;
  asks: Array<[number, number]>;
};

export interface MarketData {
  header: MarketHeader;
  baseLotsPerBaseUnit: number;
  quoteLotsPerBaseUnitPerTick: number;
  sequenceNumber: number;
  takerFeeBps: number;
  collectedAdjustedQuoteLotFees: number;
  unclaimedAdjustedQuoteLotFees: number;
  bids: Array<[OrderId, RestingOrder]>;
  asks: Array<[OrderId, RestingOrder]>;
  traders: Map<PublicKey, TraderState>;
}

export class Market {
  name: string;
  address: PublicKey;
  baseToken: Token;
  quoteToken: Token;
  data: MarketData;

  private constructor({
    name,
    address,
    baseToken,
    quoteToken,
    data,
  }: {
    name: string;
    address: PublicKey;
    baseToken: Token;
    quoteToken: Token;
    data: MarketData;
  }) {
    this.name = name;
    this.address = address;
    this.baseToken = baseToken;
    this.quoteToken = quoteToken;
    this.data = data;
  }

  /**
   * Returns a `Market` for a given market address and subscribes to updates.
   *
   * @param connection The Solana `Connection` object
   * @param marketAddress The `PublicKey` of the market account
   */
  static async load({
    connection,
    address,
  }: {
    connection: Connection;
    address: PublicKey;
  }): Promise<Market> {
    // Fetch the account data for the market
    const account = await connection.getAccountInfo(address);
    if (!account)
      throw new Error("Account not found for market: " + address.toBase58());
    const buffer = Buffer.from(account.data);
    const marketData = deserializeMarketData(buffer);

    // Parse token config data
    const allTokens = Object.values(CONFIG)
      .map(({ tokens }) => tokens)
      .flat();
    const baseTokenConfig = allTokens.find(
      (token) => token.mint === marketData.header.baseParams.mintKey.toBase58()
    );
    const baseToken = new Token({
      name: baseTokenConfig.name,
      symbol: baseTokenConfig.symbol,
      logoUri: baseTokenConfig.logoUri,
      data: {
        ...marketData.header.baseParams,
      },
    });
    const quoteTokenConfig = allTokens.find(
      (token) => token.mint === marketData.header.quoteParams.mintKey.toBase58()
    );
    const quoteToken = new Token({
      name: quoteTokenConfig.name,
      symbol: quoteTokenConfig.symbol,
      logoUri: quoteTokenConfig.logoUri,
      data: {
        ...marketData.header.quoteParams,
      },
    });

    // Create the market object
    const market = new Market({
      name: `${baseToken.symbol}/${quoteToken.symbol}`,
      address,
      baseToken,
      quoteToken,
      data: marketData,
    });

    // Set up subscription to market updates
    market.subscribeToMarketUpdates(connection);

    return market;
  }

  /**
   * Subscribes to updates for the market's data account
   *
   * @param connection The Solana `Connection` object
   */
  private subscribeToMarketUpdates(connection: Connection) {
    connection.onAccountChange(this.address, (account) => {
      const buffer = Buffer.from(account.data);
      const marketData = deserializeMarketData(buffer);
      this.data = marketData;
    });
  }

  /**
   * Returns the market's ladder of bids and asks
   *
   * @param levels The number of book levels to return
   * @param asUiLadder Whether to return bids and asks as JS numbers
   */
  getLadder(levels: number = DEFAULT_LADDER_DEPTH): Ladder {
    let bids: Array<[BN, BN]> = [];
    let asks: Array<[BN, BN]> = [];
    for (const [orderId, restingOrder] of this.data.bids) {
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
          prev[1] = numBaseLots;
        } else {
          if (bids.length === levels) {
            break;
          }
          bids.push([priceInTicks, numBaseLots]);
        }
      }
    }

    for (const [orderId, restingOrder] of this.data.asks) {
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
      asks: asks.reverse().slice(0, levels),
      bids: bids.slice(0, levels),
    };
  }

  /**
   * Converts a ladder level from BN to JS number representation
   *
   * @param priceInTicks The price of the level in ticks
   * @param sizeInBaseLots The size of the level in base lots
   * @param quoteAtomsPerQuoteUnit The number of quote atoms per quote unit
   */
  private levelToUiLevel(
    priceInTicks: BN,
    sizeInBaseLots: BN,
    quoteAtomsPerQuoteUnit: number
  ): [number, number] {
    return [
      (toNum(priceInTicks) *
        this.data.quoteLotsPerBaseUnitPerTick *
        toNum(this.data.header.quoteLotSize)) /
        quoteAtomsPerQuoteUnit,
      toNum(sizeInBaseLots) / this.data.baseLotsPerBaseUnit,
    ];
  }

  /**
   * Returns the market's ladder of bids and asks as JS numbers
   *
   * @param levels The number of book levels to return
   */
  getUiLadder(levels: number = DEFAULT_LADDER_DEPTH): UiLadder {
    const ladder = this.getLadder(levels);

    const quoteAtomsPerQuoteUnit =
      10 ** toNum(this.data.header.quoteParams.decimals);
    return {
      bids: ladder.bids.map(([priceInTicks, sizeInBaseLots]) =>
        this.levelToUiLevel(
          priceInTicks,
          sizeInBaseLots,
          quoteAtomsPerQuoteUnit
        )
      ),
      asks: ladder.asks.map(([priceInTicks, sizeInBaseLots]) =>
        this.levelToUiLevel(
          priceInTicks,
          sizeInBaseLots,
          quoteAtomsPerQuoteUnit
        )
      ),
    };
  }

  /**
   * Returns a Phoenix swap transaction
   *
   * @param market The market to swap on
   * @param type The type of order to place (limit, ioc, postOnly)
   * @param side The side of the order to place (Bid, Ask)
   * @param inAmount The amount of the input token to swap
   * @param trader The trader's wallet public key
   * @param clientOrderId The client order ID (optional)
   */
  getSwapTransaction({
    side,
    inAmount,
    trader,
    clientOrderId = 0,
  }: {
    side: Side;
    inAmount: number;
    trader: PublicKey;
    clientOrderId?: number;
  }): Transaction {
    const baseAccount = PublicKey.findProgramAddressSync(
      [
        trader.toBuffer(),
        TOKEN_PROGRAM_ID.toBuffer(),
        this.baseToken.data.mintKey.toBuffer(),
      ],
      ASSOCIATED_TOKEN_PROGRAM_ID
    )[0];

    const quoteAccount = PublicKey.findProgramAddressSync(
      [
        trader.toBuffer(),
        TOKEN_PROGRAM_ID.toBuffer(),
        this.quoteToken.data.mintKey.toBuffer(),
      ],
      ASSOCIATED_TOKEN_PROGRAM_ID
    )[0];

    const orderAccounts = {
      phoenixProgram: PROGRAM_ID,
      logAuthority: PublicKey.findProgramAddressSync(
        [Buffer.from("log")],
        PROGRAM_ID
      )[0],
      market: this.address,
      trader,
      baseAccount,
      quoteAccount,
      quoteVault: this.data.header.quoteParams.vaultKey,
      baseVault: this.data.header.baseParams.vaultKey,
    };

    const orderPacket = this.getSwapOrderPacket({
      side,
      inAmount,
      clientOrderId,
    });

    const ix = createSwapInstruction(orderAccounts, {
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
   * @param market The market to submit the order to
   * @param side The side of the order
   * @param inAmount The amount of the input token
   * @param slippage The slippage tolerance in bps (optional, default 0.5%)
   * @param selfTradeBehavior The self trade behavior (optional, default Abort)
   * @param matchLimit The match limit (optional)
   * @param clientOrderId The client order ID (optional)
   * @param useOnlyDepositedFunds Whether to use only deposited funds (optional)
   */
  getSwapOrderPacket({
    side,
    inAmount,
    slippage = DEFAULT_SLIPPAGE_PERCENT,
    selfTradeBehavior = SelfTradeBehavior.Abort,
    matchLimit = DEFAULT_MATCH_LIMIT,
    clientOrderId = 0,
    useOnlyDepositedFunds = false,
  }: {
    side: Side;
    inAmount: number;
    slippage?: number;
    selfTradeBehavior?: SelfTradeBehavior;
    matchLimit?: number;
    clientOrderId?: number;
    useOnlyDepositedFunds?: boolean;
  }): Partial<OrderPacket> {
    const expectedOutAmount = this.getExpectedOutAmount({
      side,
      inAmount,
    });
    const baseMul = 10 ** this.baseToken.data.decimals;
    const quoteMul = 10 ** this.quoteToken.data.decimals;
    const slippageDenom = 1 - slippage;
    let numBaseLots = 0;
    let minBaseLotsToFill = 0;
    let numQuoteLots = 0;
    let minQuoteLotsToFill = 0;

    if (side === Side.Ask) {
      numBaseLots =
        (inAmount * baseMul) /
        parseFloat(this.data.header.baseLotSize.toString());
      minQuoteLotsToFill = Math.ceil(
        ((expectedOutAmount * quoteMul) /
          parseFloat(this.data.header.quoteLotSize.toString())) *
          slippageDenom
      );
    } else {
      numQuoteLots =
        (inAmount * quoteMul) /
        parseFloat(this.data.header.quoteLotSize.toString());
      minBaseLotsToFill = Math.ceil(
        ((expectedOutAmount * baseMul) /
          parseFloat(this.data.header.baseLotSize.toString())) *
          slippageDenom
      );
    }

    const order: Partial<OrderPacket> = {
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

    return order;
  }

  /**
   * Returns the expected amount out for a given swap order
   *
   * @param market The market to calculate the amount out for
   * @param side The side of the order (Bid or Ask)
   * @param inAmount The amount of the input token
   */
  getExpectedOutAmount({
    side,
    inAmount,
  }: {
    side: Side;
    inAmount: number;
  }): number {
    const numBids = toNum(this.data.header.marketSizeParams.bidsSize);
    const numAsks = toNum(this.data.header.marketSizeParams.asksSize);
    const ladder = this.getUiLadder(Math.max(numBids, numAsks));

    if (side === Side.Bid) {
      let remainingQuoteUnits = inAmount * (1 - this.data.takerFeeBps / 10000);
      let expectedBaseUnitsReceived = 0;
      for (const [
        priceInQuoteUnitsPerBaseUnit,
        sizeInBaseUnits,
      ] of ladder.asks) {
        let totalQuoteUnitsAvailable =
          sizeInBaseUnits * priceInQuoteUnitsPerBaseUnit;
        if (totalQuoteUnitsAvailable > remainingQuoteUnits) {
          expectedBaseUnitsReceived +=
            remainingQuoteUnits / priceInQuoteUnitsPerBaseUnit;
          remainingQuoteUnits = 0;
          break;
        } else {
          expectedBaseUnitsReceived += sizeInBaseUnits;
          remainingQuoteUnits -= totalQuoteUnitsAvailable;
        }
      }
      return expectedBaseUnitsReceived;
    } else {
      let remainingBaseUnits = inAmount * (1 - this.data.takerFeeBps / 10000);
      let expectedQuoteUnitsReceived = 0;
      for (const [
        priceInQuoteUnitsPerBaseUnit,
        sizeInBaseUnits,
      ] of ladder.bids) {
        if (sizeInBaseUnits > remainingBaseUnits) {
          expectedQuoteUnitsReceived +=
            remainingBaseUnits * priceInQuoteUnitsPerBaseUnit;
          remainingBaseUnits = 0;
          break;
        } else {
          expectedQuoteUnitsReceived +=
            sizeInBaseUnits * priceInQuoteUnitsPerBaseUnit;
          remainingBaseUnits -= sizeInBaseUnits;
        }
      }

      return expectedQuoteUnitsReceived;
    }
  }
}

/**
 * Deserializes market data from a given buffer
 *
 * @param data The data buffer to deserialize
 */
function deserializeMarketData(data: Buffer): MarketData {
  // Deserialize the market header
  let offset = marketHeaderBeet.byteSize;
  const [header] = marketHeaderBeet.deserialize(data.subarray(0, offset));

  // Parse market data
  let remaining = data.subarray(offset);
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
  const bids = [...bidsUnsorted].sort(
    (a, b) => toNum(-a[0].priceInTicks) + toNum(b[0].priceInTicks)
  );

  // TODO: Respect price-time ordering
  const asks = [...asksUnsorted].sort(
    (a, b) => toNum(a[0].priceInTicks) - toNum(b[0].priceInTicks)
  );

  let traders = new Map<PublicKey, TraderState>();
  for (const [k, traderState] of deserializeRedBlackTree(
    traderBuffer,
    publicKeyBeet,
    traderStateBeet
  )) {
    traders.set(k.publicKey, traderState);
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
  let tree = new Map<Key, Value>();
  let offset = 0;
  let keySize = keyDeserializer.byteSize;
  let valueSize = valueDeserializer.byteSize;

  let nodes = new Array<[Key, Value]>();

  // skip RBTree header
  offset += 16;

  // Skip node allocator size
  offset += 8;
  let bumpIndex = data.readInt32LE(offset);
  offset += 4;
  let freeListHead = data.readInt32LE(offset);
  offset += 4;

  let freeListPointers = new Array<[number, number]>();

  for (let index = 0; offset < data.length && index < bumpIndex; index++) {
    let registers = new Array<number>();
    for (let i = 0; i < 4; i++) {
      registers.push(data.readInt32LE(offset)); // skip padding
      offset += 4;
    }
    let [key] = keyDeserializer.deserialize(
      data.subarray(offset, offset + keySize)
    );
    offset += keySize;
    let [value] = valueDeserializer.deserialize(
      data.subarray(offset, offset + valueSize)
    );
    offset += valueSize;
    nodes.push([key, value]);
    freeListPointers.push([index, registers[0]]);
  }

  let freeNodes = new Set<number>();
  let indexToRemove = freeListHead - 1;
  let counter = 0;
  // If there's an infinite loop here, that means that the state is corrupted
  while (freeListHead !== 0) {
    // We need to subtract 1 because the node allocator is 1-indexed
    let next = freeListPointers[freeListHead - 1];
    [indexToRemove, freeListHead] = next;
    freeNodes.add(indexToRemove);
    counter += 1;
    if (counter > bumpIndex) {
      throw new Error("Infinite loop detected");
    }
  }

  for (let [index, [key, value]] of nodes.entries()) {
    if (!freeNodes.has(index)) {
      tree.set(key, value);
    }
  }

  return tree;
}
