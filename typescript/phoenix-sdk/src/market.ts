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
} from "./utils";
import { Token } from "./token";

export type OrderId = {
  priceInTicks: beet.bignum;
  orderSequenceNumber: beet.bignum;
};

export type RestingOrder = {
  traderIndex: beet.bignum;
  numBaseLots: beet.bignum;
};

export type TraderState = {
  quoteLotsLocked: beet.bignum;
  quoteLotsFree: beet.bignum;
  baseLotsLocked: beet.bignum;
  baseLotsFree: beet.bignum;
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
  private subscriptions: Array<number>;

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
    this.subscriptions = [];
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

    return market;
  }

  /**
   * Refreshes the market data
   *
   * @param connection The Solana `Connection` object
   */
  async refresh(connection: Connection) {
    const account = await connection.getAccountInfo(this.address);
    if (!account)
      throw new Error(
        "Account not found for market: " + this.address.toBase58()
      );
    const data = Buffer.from(account.data);
    const marketData = deserializeMarketData(data);
    this.data = marketData;
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
   * @param side The side of the order to place (Bid, Ask)
   * @param inAmount The amount (in whole tokens) of the input token to swap
   * @param trader The trader's wallet public key
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

  /**
   * Subscribes to updates on the market
   *
   * @param connection The Solana `Connection` object
   */
  subscribe(connection: Connection) {
    const subId = connection.onAccountChange(this.address, (account) => {
      const marketData = deserializeMarketData(account.data);
      this.data = marketData;
    });
    this.subscriptions.push(subId);
  }

  /**
   * Unsubscribes from updates when the market is no longer needed
   *
   * @param connection The Solana `Connection` object
   */
  async unsubscribe(connection: Connection) {
    await Promise.all(
      this.subscriptions.map((subId) =>
        connection.removeAccountChangeListener(subId)
      )
    );

    this.subscriptions = [];
  }
}
