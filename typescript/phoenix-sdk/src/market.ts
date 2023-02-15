import { Connection, PublicKey } from "@solana/web3.js";
import * as beet from "@metaplex-foundation/beet";
import BN from "bn.js";

import CONFIG from "../config.json";
import { MarketHeader, Side } from "./types";
import {
  DEFAULT_SLIPPAGE_PERCENT,
  deserializeMarketData,
  getMarketLadder,
  getMarketUiLadder,
  printUiLadder,
  getMarketSwapTransaction,
  getMarketExpectedOutAmount,
  getClusterFromEndpoint,
  toNum,
} from "./utils";
import { Token } from "./token";

export type OrderId = {
  priceInTicks: beet.bignum;
  orderSequenceNumber: beet.bignum;
};

export type RestingOrder = {
  traderIndex: beet.bignum;
  numBaseLots: beet.bignum;
  padding: beet.bignum[]; // size: 2
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

    const allTokens =
      CONFIG[getClusterFromEndpoint(connection.rpcEndpoint)].tokens;

    const baseTokenConfig = allTokens.find(
      (token) => token.mint === marketData.header.baseParams.mintKey.toBase58()
    );
    const quoteTokenConfig = allTokens.find(
      (token) => token.mint === marketData.header.quoteParams.mintKey.toBase58()
    );

    if (baseTokenConfig === undefined) {
      throw new Error(
        `Base token ${marketData.header.baseParams.mintKey} not found in config`
      );
    }
    if (quoteTokenConfig === undefined) {
      throw new Error(
        `Quote token ${marketData.header.quoteParams.mintKey} not found in config`
      );
    }

    const baseToken = new Token({
      name: baseTokenConfig.name,
      symbol: baseTokenConfig.symbol,
      logoUri: baseTokenConfig.logoUri,
      data: {
        ...marketData.header.baseParams,
      },
    });

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

    return market;
  }

  /**
   * Refreshes the market data
   *
   * @param connection The Solana `Connection` object
   *
   * @returns The refreshed Market
   */
  async refresh(connection: Connection): Promise<Market> {
    const account = await connection.getAccountInfo(this.address);
    const data = Buffer.from(account.data);
    const marketData = deserializeMarketData(data);
    this.data = marketData;

    return this;
  }

  /**
   * Returns the market's ladder of bids and asks
   */
  getLadder(): Ladder {
    return getMarketLadder(this.data);
  }

  /**
   * Returns the market's ladder of bids and asks  as JS numbers
   */
  getUiLadder(): UiLadder {
    return getMarketUiLadder(this.data);
  }

  /**
   * Pretty prints the market's current ladder of bids and asks
   */
  printLadder() {
    printUiLadder(this.getUiLadder());
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
   */
  getExpectedOutAmount({
    side,
    inAmount,
  }: {
    side: Side;
    inAmount: number;
  }): number {
    return getMarketExpectedOutAmount({
      marketData: this.data,
      side,
      inAmount,
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
    let precision = Math.max(exp2, exp5);
    return (
      Math.max(precision, 3) +
      Math.floor(
        Math.log10(Math.max(this.data.header.rawBaseUnitsPerBaseUnit, 1))
      )
    );
  }
}
