import { PublicKey } from "@solana/web3.js";
import * as beet from "@metaplex-foundation/beet";
import BN from "bn.js";

import { MarketHeader, Side } from "./types";
import {
  DEFAULT_SLIPPAGE_PERCENT,
  deserializeMarketData,
  getMarketUiLadder,
  getMarketSwapTransaction,
  toNum,
} from "./utils";
import { Token } from "./token";
import {
  TokenConfig,
  getExpectedOutAmountRouter,
  getRequiredInAmountRouter,
} from "./index";

export type OrderId = {
  priceInTicks: beet.bignum;
  orderSequenceNumber: beet.bignum;
};

export type RestingOrder = {
  traderIndex: beet.bignum;
  numBaseLots: beet.bignum;
  lastValidSlot: beet.bignum;
  lastValidUnixTimestampInSeconds: beet.bignum;
};

export type TraderState = {
  quoteLotsLocked: beet.bignum;
  quoteLotsFree: beet.bignum;
  baseLotsLocked: beet.bignum;
  baseLotsFree: beet.bignum;
  padding: beet.bignum[]; // size: 8
};

export type Ladder = {
  bids: Array<[BN, BN]>;
  asks: Array<[BN, BN]>;
};

export type L3Order = {
  priceInTicks: BN;
  side: Side;
  sizeInBaseLots: BN;
  makerPubkey: string;
  orderSequenceNumber: BN;
  lastValidSlot: BN;
  lastValidUnixTimestampInSeconds: BN;
};

export type L3UiOrder = {
  price: number;
  side: Side;
  size: number;
  makerPubkey: string;
  orderSequenceNumber: string;
  lastValidSlot: number;
  lastValidUnixTimestampInSeconds: number;
};

export type L3Book = {
  bids: L3Order[];
  asks: L3Order[];
};

export type L3UiBook = {
  bids: L3UiOrder[];
  asks: L3UiOrder[];
};

export type UiLadder = {
  bids: Array<[number, number]>;
  asks: Array<[number, number]>;
};

export interface MarketData {
  // The raw MarketHeader from the market account
  header: MarketHeader;

  // The number of base lots per base unit
  baseLotsPerBaseUnit: number;

  // Tick size of the market, in quote lots per base unit
  // Note that the header contains tick size in quote atoms per base unit
  quoteLotsPerBaseUnitPerTick: number;

  // The next order sequence number of the market
  sequenceNumber: number;

  // Taker fee in basis points
  takerFeeBps: number;

  // Total fees collected by the market and claimed by fee recipient, in quote lots
  collectedQuoteLotFees: number;

  // Total unclaimed fees in the market, in quote lots
  unclaimedQuoteLotFees: number;

  // The bids on the market, sorted from highest to lowest price
  bids: Array<[OrderId, RestingOrder]>;

  // The asks on the market, sorted from lowest to highest price
  asks: Array<[OrderId, RestingOrder]>;

  // Map from trader pubkey to trader state
  traders: Map<string, TraderState>;

  // Map from trader pubkey to trader index
  traderPubkeyToTraderIndex: Map<string, number>;

  // Map from trader index to trader pubkey
  traderIndexToTraderPubkey: Map<number, string>;
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
   * Returns a `Market` for a given address, a data buffer, and a list of tokens to use for the market
   *
   * @param connection The Solana `Connection` object
   * @param marketAddress The `PublicKey` of the market account
   * @param tokenList The list of tokens to use for the market
   */
  static load({
    address,
    buffer,
    tokenList,
  }: {
    address: PublicKey;
    buffer: Buffer;
    tokenList: TokenConfig[];
  }): Market {
    const marketData = deserializeMarketData(buffer);

    const baseTokenConfig = tokenList.find(
      (token) => token.mint === marketData.header.baseParams.mintKey.toBase58()
    );
    const quoteTokenConfig = tokenList.find(
      (token) => token.mint === marketData.header.quoteParams.mintKey.toBase58()
    );

    const baseKey = marketData.header.baseParams.mintKey.toBase58();
    const baseKeyNameBackup = baseKey.slice(0, 8) + "..." + baseKey.slice(-8);
    const quoteKey = marketData.header.baseParams.mintKey.toBase58();
    const quoteKeyNameBackup =
      quoteKey.slice(0, 8) + "..." + quoteKey.slice(-8);

    const baseToken = new Token({
      name:
        baseTokenConfig !== undefined
          ? baseTokenConfig.name
          : baseKeyNameBackup,
      symbol: baseTokenConfig !== undefined ? baseTokenConfig.symbol : baseKey,
      logoUri:
        baseTokenConfig !== undefined ? baseTokenConfig.logoUri : "Unknown",
      data: {
        ...marketData.header.baseParams,
      },
    });

    const quoteToken = new Token({
      name:
        quoteTokenConfig !== undefined
          ? quoteTokenConfig.name
          : quoteKeyNameBackup,
      symbol:
        quoteTokenConfig !== undefined ? quoteTokenConfig.symbol : quoteKey,
      logoUri:
        quoteTokenConfig !== undefined ? quoteTokenConfig.logoUri : "Unknown",
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

    return market;
  }

  /**
   * Reloads market data from buffer
   *
   * @param buffer A data buffer with the serialized market data
   *
   * @returns The reloaded Market
   */
  reload(buffer: Buffer): Market {
    const marketData = deserializeMarketData(buffer);
    this.data = marketData;
    return this;
  }

  /**
   * Returns a Phoenix swap transaction
   *
   * @param trader The `PublicKey` of the trader
   * @param side The side of the order to place (Bid, Ask)
   * @param inAmount The amount (in whole tokens) of the input token to swap
   * @param slippage The slippage tolerance (optional, default 0.5%)
   * @param clientOrderId The client order ID (optional)
   */
  getSwapTransaction({
    trader,
    side,
    inAmount,
    slippage = DEFAULT_SLIPPAGE_PERCENT,
    clientOrderId = 0,
  }: {
    trader: PublicKey;
    side: Side;
    inAmount: number;
    slippage?: number;
    clientOrderId?: number;
  }) {
    return getMarketSwapTransaction({
      marketAddress: this.address,
      marketData: this.data,
      trader,
      side,
      inAmount,
      slippage,
      clientOrderId,
    });
  }

  /**
   * Returns the expected amount out for a given swap order
   *
   * @param side The side of the order (Bid or Ask)
   * @param inAmount The amount of the input token
   * @param slot The current slot
   * @param unixTimestamp The current unix timestamp, in seconds
   */
  getExpectedOutAmount({
    side,
    inAmount,
    slot,
    unixTimestamp,
  }: {
    side: Side;
    inAmount: number;
    slot: beet.bignum;
    unixTimestamp: beet.bignum;
  }): number {
    const numBids = toNum(this.data.header.marketSizeParams.bidsSize);
    const numAsks = toNum(this.data.header.marketSizeParams.asksSize);
    const uiLadder = getMarketUiLadder(
      this.data,
      Math.max(numBids, numAsks),
      slot,
      unixTimestamp
    );

    return getExpectedOutAmountRouter({
      uiLadder,
      side,
      takerFeeBps: this.data.takerFeeBps,
      inAmount,
    });
  }

  /**
   * Returns the required amount in for a desired amount of units out
   *
   * @param side The side of the order (Bid or Ask)
   * @param outAmount The amount of the desired output token
   * @param slot The current slot
   * @param unixTimestamp The current unix timestamp, in seconds
   */
  getRequiredInAmount({
    side,
    outAmount,
    slot,
    unixTimestamp,
  }: {
    side: Side;
    outAmount: number;
    slot: beet.bignum;
    unixTimestamp: beet.bignum;
  }): number {
    const numBids = toNum(this.data.header.marketSizeParams.bidsSize);
    const numAsks = toNum(this.data.header.marketSizeParams.asksSize);
    const uiLadder = getMarketUiLadder(
      this.data,
      Math.max(numBids, numAsks),
      slot,
      unixTimestamp
    );

    return getRequiredInAmountRouter({
      uiLadder,
      side,
      takerFeeBps: this.data.takerFeeBps,
      outAmount,
    });
  }

  getPriceDecimalPlaces(): number {
    let target =
      Math.pow(10, this.data.header.quoteParams.decimals) /
      toNum(this.data.header.tickSizeInQuoteAtomsPerBaseUnit);

    let exp2 = 0;
    while (target % 2 === 0) {
      target /= 2;
      exp2 += 1;
    }
    let exp5 = 0;
    while (target % 5 === 0) {
      target /= 5;
      exp5 += 1;
    }
    const precision = Math.max(exp2, exp5);
    return (
      Math.max(precision, 3) +
      Math.floor(
        Math.log10(Math.max(this.data.header.rawBaseUnitsPerBaseUnit, 1))
      )
    );
  }
}
