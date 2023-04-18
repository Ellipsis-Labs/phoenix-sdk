import {
  AccountInfo,
  Connection,
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
} from "@solana/web3.js";
import { getClusterFromEndpoint, toNum } from "./utils";
import { Token } from "./token";
import { Market } from "./market";
import { Trader } from "./trader";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  ClockData,
  DEFAULT_L2_LADDER_DEPTH,
  Ladder,
  PROGRAM_ID,
  Side,
  UiLadder,
  deserializeClockData,
  getMarketLadder,
  getMarketUiLadder,
  printUiLadder,
  getMarketL3Book,
  DEFAULT_L3_BOOK_DEPTH,
  L3Book,
  L3UiBook,
  getMarketL3UiBook,
} from "./index";
import { bignum } from "@metaplex-foundation/beet";

export type TokenConfig = {
  name: string;
  symbol: string;
  mint: string;
  logoUri: string;
};

export class Client {
  connection: Connection;
  trader: Trader;
  tokenConfig: Array<TokenConfig>;
  tokens: Array<Token>;
  markets: Map<string, Market>;
  clock: ClockData;

  private constructor({
    connection,
    tokens,
    tokenConfig,
    markets,
    clock,
    trader,
  }: {
    connection: Connection;
    tokens: Array<Token>;
    tokenConfig: Array<TokenConfig>;
    markets: Map<string, Market>;
    clock: ClockData;
    trader?: Trader;
  }) {
    this.connection = connection;
    this.tokens = tokens;
    this.tokenConfig = tokenConfig;
    this.markets = markets;
    this.clock = clock;
    if (trader) {
      this.trader = trader;
    }
  }

  static loadMarketsAndTokens(
    marketKeysAndData: Array<[PublicKey, AccountInfo<Buffer>]>,
    tokenConfig: Array<TokenConfig>
  ): [Map<string, Market>, Token[]] {
    const tokens: Array<Token> = [];
    const markets = new Map();
    // For every market:
    marketKeysAndData.map(([marketAddress, marketAccount]) => {
      // Load the market
      const market = Market.load({
        address: marketAddress,
        buffer: marketAccount.data,
        tokenList: tokenConfig,
      });

      markets.set(marketAddress.toString(), market);

      // Set the tokens from the market (avoiding duplicates)
      for (const token of [market.baseToken, market.quoteToken]) {
        const mint = token.data.mintKey.toBase58();
        if (
          tokens.find((t) => {
            return t.data.mintKey.toBase58() === mint;
          })
        )
          continue;
        tokens.push(token);
      }
    });
    return [markets, tokens];
  }

  /**
   * Creates a new `PhoenixClient`
   *
   * @param connection The Solana `Connection` to use for the client
   * @param endpoint Solana cluster to use - "mainnet", "devnet", or "localnet"
   * @param trader The `PublicKey` of the trader account to use for the client (optional)
   */
  static async create(
    connection: Connection,
    endpoint: string,
    trader?: PublicKey
  ): Promise<Client> {
    const cluster = getClusterFromEndpoint(endpoint);
    const configUrl =
      "https://raw.githubusercontent.com/Ellipsis-Labs/phoenix-sdk/master/typescript/phoenix-sdk/config.json";

    const marketConfigs = await fetch(configUrl).then((response) => {
      return response.json();
    });

    const marketAddresses: PublicKey[] = marketConfigs[cluster].markets.map(
      (marketAddress: string) => {
        return new PublicKey(marketAddress);
      }
    );

    const tokenConfig = marketConfigs[cluster].tokens;

    const accounts = await connection.getMultipleAccountsInfo(
      [...marketAddresses, SYSVAR_CLOCK_PUBKEY],
      "confirmed"
    );

    const clockBuffer = accounts.pop()?.data;
    if (clockBuffer === undefined) {
      throw new Error("Unable to get clock");
    }

    const clock = deserializeClockData(clockBuffer);
    const marketKeysAndData: Array<[PublicKey, AccountInfo<Buffer>]> =
      marketAddresses.map((marketAddress, index) => {
        return [marketAddress, accounts[index] as AccountInfo<Buffer>];
      });

    const [markets, tokens] = Client.loadMarketsAndTokens(
      marketKeysAndData,
      tokenConfig
    );

    return new Client({
      connection,
      tokens,
      markets,
      tokenConfig,
      trader: trader
        ? await Trader.create({
            connection,
            pubkey: trader,
            tokens,
          })
        : undefined,
      clock,
    });
  }

  static async createWithoutConfig(
    connection: Connection,
    marketAddresses: PublicKey[],
    trader?: PublicKey
  ): Promise<Client> {
    const accounts = await connection.getMultipleAccountsInfo(
      [...marketAddresses, SYSVAR_CLOCK_PUBKEY],
      "confirmed"
    );

    const clockBuffer = accounts.pop()?.data;
    if (clockBuffer === undefined) {
      throw new Error("Unable to get clock");
    }
    const clock = deserializeClockData(clockBuffer);

    if (accounts.length !== marketAddresses.length) {
      throw Error("Unable to get all market accounts");
    }

    const marketKeysAndData: Array<[PublicKey, AccountInfo<Buffer>]> =
      marketAddresses.map((marketAddress, index) => {
        return [marketAddress, accounts[index] as AccountInfo<Buffer>];
      });

    const [markets, tokens] = Client.loadMarketsAndTokens(
      marketKeysAndData,
      []
    );

    return new Client({
      connection,
      tokens,
      markets,
      tokenConfig: [],
      trader: trader
        ? await Trader.create({
            connection,
            pubkey: trader,
            tokens,
          })
        : undefined,
      clock,
    });
  }

  static async createWithMarketAddresses(
    connection: Connection,
    endpoint: string,
    marketAddresses: PublicKey[],
    trader?: PublicKey
  ): Promise<Client> {
    const cluster = getClusterFromEndpoint(endpoint);
    const configUrl =
      "https://raw.githubusercontent.com/Ellipsis-Labs/phoenix-sdk/master/typescript/phoenix-sdk/config.json";

    const marketConfigs = await fetch(configUrl).then((response) => {
      return response.json();
    });
    const tokenConfig = marketConfigs[cluster].tokens;
    const accounts = await connection.getMultipleAccountsInfo(
      [...marketAddresses, SYSVAR_CLOCK_PUBKEY],
      "confirmed"
    );

    const clockBuffer = accounts.pop()?.data;
    if (clockBuffer === undefined) {
      throw new Error("Unable to get clock");
    }
    const clock = deserializeClockData(clockBuffer);

    const marketKeysAndData: Array<[PublicKey, AccountInfo<Buffer>]> =
      marketAddresses.map((marketAddress, index) => {
        return [marketAddress, accounts[index] as AccountInfo<Buffer>];
      });

    const [markets, tokens] = Client.loadMarketsAndTokens(
      marketKeysAndData,
      tokenConfig
    );

    return new Client({
      connection,
      tokens,
      markets,
      tokenConfig,
      trader: trader
        ? await Trader.create({
            connection,
            pubkey: trader,
            tokens,
          })
        : undefined,
      clock,
    });
  }

  /**
   * Add a market to the client. Useful for localnet as markets will not be loaded in by default.
   * @param marketAddress The `PublicKey` of the market account
   * @param forceReload If this is set to true, it will reload the market even if it already exists
   *
   */
  public async addMarket(marketAddress: string, forceReload = false) {
    const existingMarket = this.markets.get(marketAddress);

    // If the market already exists, return
    if (existingMarket !== undefined) {
      if (forceReload) {
        await this.refreshMarket(marketAddress);
      } else {
        console.log("Market already exists: ", marketAddress);
      }
      return;
    }

    const marketKey = new PublicKey(marketAddress);
    const accounts = await this.connection.getMultipleAccountsInfo(
      [marketKey, SYSVAR_CLOCK_PUBKEY],
      "confirmed"
    );
    if (accounts.length !== 2)
      throw new Error("Account not found for market: " + marketKey.toBase58());

    const buffer = accounts[0]?.data;
    if (buffer === undefined) {
      throw new Error("Unable to get market account data");
    }

    const market = await Market.load({
      address: marketKey,
      buffer,
      tokenList: this.tokenConfig,
    });
    for (const token of [market.baseToken, market.quoteToken]) {
      const mint = token.data.mintKey.toBase58();
      if (this.tokens.find((t) => t.data.mintKey.toBase58() === mint)) continue;
      this.tokens.push(token);
    }
    this.markets.set(marketAddress, market);
    const clockBuffer = accounts[1]?.data;
    if (clockBuffer === undefined) {
      throw new Error("Unable to get clock");
    }
    this.reloadClockFromBuffer(clockBuffer);
  }

  /**
   * Refreshes the market data for all markets and the clock
   */
  public async refreshAllMarkets() {
    const marketKeys = Array.from(this.markets.keys()).map((market) => {
      return new PublicKey(market);
    });
    const accounts = await this.connection.getMultipleAccountsInfo(
      [...marketKeys, SYSVAR_CLOCK_PUBKEY],
      "confirmed"
    );

    const clockBuffer = accounts.pop()?.data;
    if (clockBuffer === undefined) {
      throw new Error("Unable to get clock");
    }
    this.reloadClockFromBuffer(clockBuffer);

    for (const [i, marketKey] of marketKeys.entries()) {
      const existingMarket = this.markets.get(marketKey.toString());
      if (existingMarket === undefined) {
        throw new Error("Market does not exist: " + marketKey.toBase58());
      }
      const buffer = accounts[i]?.data;
      if (buffer === undefined) {
        throw new Error("Unable to get market account data");
      }
      existingMarket.reload(buffer);
    }
  }

  /**
   * Refreshes the market data and clock
   *
   * @param marketAddress The address of the market to refresh
   *
   * @returns The refreshed Market
   */
  public async refreshMarket(
    marketAddress: string | PublicKey
  ): Promise<Market> {
    const marketKey = new PublicKey(marketAddress);
    const existingMarket = this.markets.get(marketKey.toString());
    if (existingMarket === undefined) {
      throw new Error("Market does not exist: " + marketKey.toBase58());
    }
    const accounts = await this.connection.getMultipleAccountsInfo(
      [marketKey, SYSVAR_CLOCK_PUBKEY],
      "confirmed"
    );
    if (accounts.length !== 2)
      throw new Error("Account not found for market: " + marketKey.toBase58());

    const buffer = accounts[0]?.data;
    if (buffer === undefined) {
      throw new Error("Unable to get market account data");
    }
    existingMarket.reload(buffer);
    const clockBuffer = accounts[1]?.data;
    if (clockBuffer === undefined) {
      throw new Error("Unable to get clock");
    }
    this.reloadClockFromBuffer(clockBuffer);

    return existingMarket;
  }

  public async reloadClock() {
    const clockAccount = await this.connection.getAccountInfo(
      SYSVAR_CLOCK_PUBKEY,
      "confirmed"
    );
    const clockBuffer = clockAccount?.data;
    if (clockBuffer === undefined) {
      throw new Error("Unable to get clock");
    }

    this.reloadClockFromBuffer(clockBuffer);
  }

  reloadClockFromBuffer(clockBuffer: Buffer) {
    this.clock = deserializeClockData(clockBuffer);
  }

  /**
   * Returns the market's ladder of bids and asks
   * @param marketAddress The `PublicKey` of the market account
   * @param levels The number of levels to return
   */
  public getLadder(
    marketAddress: string,
    levels: number = DEFAULT_L2_LADDER_DEPTH
  ): Ladder {
    const market = this.markets.get(marketAddress);
    if (!market) throw new Error("Market not found: " + marketAddress);
    return getMarketLadder(
      market.data,
      this.clock.slot,
      this.clock.unixTimestamp,
      levels
    );
  }

  /**
   * Returns the market's ladder of bids and asks as JS numbers
   * @param marketAddress The `PublicKey` of the market account
   * @param levels The number of levels to return
   */
  public getUiLadder(
    marketAddress: string,
    levels: number = DEFAULT_L2_LADDER_DEPTH
  ): UiLadder {
    const market = this.markets.get(marketAddress);
    if (!market) throw new Error("Market not found: " + marketAddress);
    return getMarketUiLadder(
      market.data,
      levels,
      this.clock.slot,
      this.clock.unixTimestamp
    );
  }

  /**
   * Returns the L3 book for a market. Note that the returned book will not contain expired orders.
   * To include expired orders, use `getL3BookWithParams`, with a startingValidSlot or startingUnixTimeStampInSeconds argument BEFORE the expiration slot or time.
   * @param marketAddress The `PublicKey` of the market account
   * @param ordersPerSide The number of orders to return per side
   */
  public getL3Book(
    marketAddress: string,
    ordersPerSide: number = DEFAULT_L3_BOOK_DEPTH
  ): L3Book {
    const market = this.markets.get(marketAddress);
    if (!market) throw new Error("Market not found: " + marketAddress);
    return getMarketL3Book(
      market.data,
      this.clock.slot,
      this.clock.unixTimestamp,
      ordersPerSide
    );
  }

  /**
   * Returns the L3 book for a market, with a starting valid slot and starting unix timestamp.
   * Time-in-force orders with a last valid slot or last valid timestamp after the specified starting slot or timestamp will be included.
   * For example, if the startingValidSlot is 0 and startingUnixTimestampInSeconds is 0, all orders, including expired ones, will be included.
   * @param marketAddress
   * @param startingValidSlot
   * @param startingUnixTimestampInSeconds
   * @param ordersPerSide
   */
  public getL3BookWithParams(
    marketAddress: string,
    startingValidSlot: bignum,
    startingUnixTimestampInSeconds: bignum,
    ordersPerSide: number = DEFAULT_L3_BOOK_DEPTH
  ): L3Book {
    const market = this.markets.get(marketAddress);
    if (!market) throw new Error("Market not found: " + marketAddress);
    return getMarketL3Book(
      market.data,
      startingValidSlot,
      startingUnixTimestampInSeconds,
      ordersPerSide
    );
  }

  /**
   * Returns the L3 UI book for a market. Note that the returned book will not contain expired orders.
   * To include expired orders, use `getL3UiBookWithParams`, with a startingValidSlot or startingUnixTimeStampInSeconds argument BEFORE the expiration slot or time.
   * @param marketAddress The `PublicKey` of the market account
   * @param ordersPerSide The number of orders to return per side
   */
  public getL3UiBook(
    marketAddress: string,
    ordersPerSide: number = DEFAULT_L3_BOOK_DEPTH
  ): L3UiBook {
    const market = this.markets.get(marketAddress);
    if (!market) throw new Error("Market not found: " + marketAddress);
    return getMarketL3UiBook(
      market.data,
      ordersPerSide,
      this.clock.slot,
      this.clock.unixTimestamp
    );
  }

  /**
   * Returns the L3 UI book for a market, with a starting valid slot and starting unix timestamp.
   * Time-in-force orders with a last valid slot or last valid timestamp after the specified starting slot or timestamp will be included.
   * For example, if the startingValidSlot is 0 and startingUnixTimestampInSeconds is 0, all orders, including expired ones, will be included.
   * @param marketAddress
   * @param startingValidSlot
   * @param startingUnixTimestampInSeconds
   * @param ordersPerSide
   * @returns
   */
  public getL3UiBookWithParams(
    marketAddress: string,
    startingValidSlot: bignum,
    startingUnixTimestampInSeconds: bignum,
    ordersPerSide: number = DEFAULT_L3_BOOK_DEPTH
  ): L3UiBook {
    const market = this.markets.get(marketAddress);
    if (!market) throw new Error("Market not found: " + marketAddress);
    return getMarketL3UiBook(
      market.data,
      ordersPerSide,
      startingValidSlot,
      startingUnixTimestampInSeconds
    );
  }

  /**
   * Pretty prints the market's current ladder of bids and asks
   */
  public printLadder(marketAddress: string) {
    printUiLadder(this.getUiLadder(marketAddress));
  }

  /**
   * Returns the expected amount out for a given swap order
   *
   * @param marketAddress The `MarketAddress` for the swap market
   * @param side The side of the order (Bid or Ask)
   * @param inAmount The amount of the input token
   *
   */
  public getMarketExpectedOutAmount({
    marketAddress,
    side,
    inAmount,
  }: {
    marketAddress: string;
    side: Side;
    inAmount: number;
  }): number {
    const market = this.markets.get(marketAddress);
    if (!market) throw new Error("Market not found: " + marketAddress);
    return market.getExpectedOutAmount({
      side,
      inAmount,
      slot: this.clock.slot,
      unixTimestamp: this.clock.unixTimestamp,
    });
  }

  /**
   * Get a trader's base token account Pubkey for a given market
   *
   * @param trader The `PublicKey` of the trader account
   * @param marketAddress The `PublicKey` of the market account, as a string
   */
  public getBaseAccountKey(
    trader: PublicKey,
    marketAddress: string
  ): PublicKey {
    const market = this.markets.get(marketAddress);
    if (!market) throw new Error("Market not found: " + marketAddress);
    return PublicKey.findProgramAddressSync(
      [
        trader.toBuffer(),
        TOKEN_PROGRAM_ID.toBuffer(),
        market.data.header.baseParams.mintKey.toBuffer(),
      ],
      ASSOCIATED_TOKEN_PROGRAM_ID
    )[0];
  }

  /**
   * Get a trader's quote token account Pubkey for a given market
   *
   * @param trader The `PublicKey` of the trader account
   * @param marketAddress The `PublicKey` of the market account, as a string
   */
  public getQuoteAccountKey(
    trader: PublicKey,
    marketAddress: string
  ): PublicKey {
    const market = this.markets.get(marketAddress);
    if (!market) throw new Error("Market not found: " + marketAddress);
    return PublicKey.findProgramAddressSync(
      [
        trader.toBuffer(),
        TOKEN_PROGRAM_ID.toBuffer(),
        market.data.header.quoteParams.mintKey.toBuffer(),
      ],
      ASSOCIATED_TOKEN_PROGRAM_ID
    )[0];
  }

  /**
   * Get a trader's seat account Pubkey for a given market
   *
   * @param trader The `PublicKey` of the trader account
   * @param marketAddress The `PublicKey` of the market account, as a string
   */
  public getSeatKey(trader: PublicKey, marketAddress: string): PublicKey {
    const market = this.markets.get(marketAddress);
    if (!market) throw new Error("Market not found: " + marketAddress);
    const marketPubkey = new PublicKey(marketAddress);
    return PublicKey.findProgramAddressSync(
      [Buffer.from("seat"), marketPubkey.toBuffer(), trader.toBuffer()],
      PROGRAM_ID
    )[0];
  }

  /**
   * Returns the Phoenix log authority Pubkey
   */
  public getLogAuthority(): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("log")],
      PROGRAM_ID
    )[0];
  }

  /**
   * Given a price in quote units per raw base unit, returns the price in ticks.
   *
   * Example: With a market tick size of 0.01, and a price of 1.23 quote units per raw base unit, the price in ticks is 123
   *
   * @param price The price to convert
   * @param marketAddress The `PublicKey` of the market account, as a string
   */
  public floatPriceToTicks(price: number, marketAddress: string): number {
    const market = this.markets.get(marketAddress);
    if (!market) throw new Error("Market not found: " + marketAddress);

    return Math.round(
      (price *
        market.data.header.rawBaseUnitsPerBaseUnit *
        10 ** market.quoteToken.data.decimals) /
        (market.data.quoteLotsPerBaseUnitPerTick *
          toNum(market.data.header.quoteLotSize))
    );
  }

  /**
   * Given a price in ticks, returns the price in quote units per raw base unit.
   *
   * Example: With a market tick size of 0.01, and a price of 123 ticks, the price in quote units per raw base unit is 1.23
   *
   * @param ticks The price in ticks to convert
   * @param marketAddress The `PublicKey` of the market account, as a string
   */
  public ticksToFloatPrice(ticks: number, marketAddress: string): number {
    const market = this.markets.get(marketAddress);
    if (!market) throw new Error("Market not found: " + marketAddress);
    return (
      (ticks *
        market.data.quoteLotsPerBaseUnitPerTick *
        toNum(market.data.header.quoteLotSize)) /
      (10 ** market.quoteToken.data.decimals *
        market.data.header.rawBaseUnitsPerBaseUnit)
    );
  }

  /**
   * Given a number of raw base units, returns the equivalent number of base lots (rounded down).
   *
   * @param rawBaseUnits The amount of raw base units to convert
   * @param marketAddress The `PublicKey` of the market account, as a string
   */
  public rawBaseUnitsToBaseLotsRoundedDown(
    rawBaseUnits: number,
    marketAddress: string
  ): number {
    const market = this.markets.get(marketAddress);
    if (!market) throw new Error("Market not found: " + marketAddress);
    const baseUnits = rawBaseUnits / market.data.header.rawBaseUnitsPerBaseUnit;
    return Math.floor(baseUnits * market.data.baseLotsPerBaseUnit);
  }

  /**
   * Given a number of raw base units, returns the equivalent number of base lots (rounded up).
   *
   * @param rawBaseUnits The amount of raw base units to convert
   * @param marketAddress The `PublicKey` of the market account, as a string
   */
  public rawBaseUnitsToBaseLotsRoundedUp(
    rawBaseUnits: number,
    marketAddress: string
  ): number {
    const market = this.markets.get(marketAddress);
    if (!market) throw new Error("Market not found: " + marketAddress);
    const baseUnits = rawBaseUnits / market.data.header.rawBaseUnitsPerBaseUnit;
    return Math.ceil(baseUnits * market.data.baseLotsPerBaseUnit);
  }

  /**
   * Given a number of base atoms, returns the equivalent number of base lots.
   *
   * @param baseAtoms The amount of base atoms to convert
   * @param marketAddress The `PublicKey` of the market account, as a string
   */
  public baseAtomsToBaseLots(baseAtoms: number, marketAddress: string): number {
    const market = this.markets.get(marketAddress);
    if (!market) throw new Error("Market not found: " + marketAddress);
    return Math.round(baseAtoms / toNum(market.data.header.baseLotSize));
  }

  /**
   * Given a number of base lots, returns the equivalent number of base atoms.
   *
   * @param baseLots The amount of base lots to convert
   * @param marketAddress The `PublicKey` of the market account, as a string
   */
  public baseLotsToBaseAtoms(baseLots: number, marketAddress: string): number {
    const market = this.markets.get(marketAddress);
    if (!market) throw new Error("Market not found: " + marketAddress);
    return baseLots * toNum(market.data.header.baseLotSize);
  }

  /**
   * Given a number of quote units, returns the equivalent number of quote lots.
   *
   * @param quoteUnits The amount of quote units to convert
   * @param marketAddress The `PublicKey` of the market account, as a string
   */
  public quoteUnitsToQuoteLots(
    quoteUnits: number,
    marketAddress: string
  ): number {
    const market = this.markets.get(marketAddress);
    if (!market) throw new Error("Market not found: " + marketAddress);
    return Math.round(
      (quoteUnits * 10 ** market.quoteToken.data.decimals) /
        toNum(market.data.header.quoteLotSize)
    );
  }

  /**
   * Given a number of quote atoms, returns the equivalent number of quote lots.
   *
   * @param quoteAtoms The amount of quote atoms to convert
   * @param marketAddress The `PublicKey` of the market account, as a string
   */
  public quoteAtomsToQuoteLots(
    quoteAtoms: number,
    marketAddress: string
  ): number {
    const market = this.markets.get(marketAddress);
    if (!market) throw new Error("Market not found: " + marketAddress);
    return Math.round(quoteAtoms / toNum(market.data.header.quoteLotSize));
  }

  /**
   * Given a number of quote lots, returns the equivalent number of quote atoms.
   *
   * @param quoteLots The amount of quote lots to convert
   * @param marketAddress The `PublicKey` of the market account, as a string
   */
  public quoteLotsToQuoteAtoms(
    quoteLots: number,
    marketAddress: string
  ): number {
    const market = this.markets.get(marketAddress);
    if (!market) throw new Error("Market not found: " + marketAddress);
    return quoteLots * toNum(market.data.header.quoteLotSize);
  }

  /**
   * Given a number of base atoms, returns the equivalent number of raw base units.
   *
   * @param baseAtoms The amount of base atoms to convert
   * @param marketAddress The `PublicKey` of the market account, as a string
   */
  public baseAtomsToRawBaseUnits(
    baseAtoms: number,
    marketAddress: string
  ): number {
    const market = this.markets.get(marketAddress);
    if (!market) throw new Error("Market not found: " + marketAddress);
    return baseAtoms / 10 ** market.baseToken.data.decimals;
  }

  /**
   * Given a number of quote atoms, returns the equivalent number of quote units.
   *
   * @param quoteAtoms The amount of quote atoms to convert
   * @param marketAddress The `PublicKey` of the market account, as a string
   */
  public quoteAtomsToQuoteUnits(
    quoteAtoms: number,
    marketAddress: string
  ): number {
    const market = this.markets.get(marketAddress);
    if (!market) throw new Error("Market not found: " + marketAddress);
    return quoteAtoms / 10 ** market.quoteToken.data.decimals;
  }
}
