import {
  Connection,
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
  TransactionInstruction,
} from "@solana/web3.js";
import { Cluster, getClusterFromConnection } from "./utils";
import { MarketState } from "./market";
import {
  ClockData,
  PostOnlyOrderTemplate,
  DEFAULT_L2_LADDER_DEPTH,
  Ladder,
  Side,
  UiLadder,
  deserializeClockData,
  printUiLadder,
  getMarketL3Book,
  DEFAULT_L3_BOOK_DEPTH,
  L3Book,
  L3UiBook,
  getMarketL3UiBook,
  CancelMultipleOrdersByIdInstructionArgs,
  CancelMultipleOrdersByIdWithFreeFundsInstructionArgs,
  CancelUpToInstructionArgs,
  CancelUpToWithFreeFundsInstructionArgs,
  DepositFundsInstructionArgs,
  PlaceMultiplePostOnlyOrdersInstructionArgs,
  ReduceOrderInstructionArgs,
  ReduceOrderWithFreeFundsInstructionArgs,
  WithdrawFundsInstructionArgs,
  OrderPacket,
  LimitOrderTemplate,
  ImmediateOrCancelOrderTemplate,
} from "./index";
import { bignum } from "@metaplex-foundation/beet";
import { MarketMetadata } from "./marketMetadata";
import {
  getConfirmedMarketsAndClockAccounts,
  getConfirmedMarketsAndClockAccountsZstd,
} from "./utils/connection";

const DEFAULT_CONFIG_URL =
  "https://raw.githubusercontent.com/Ellipsis-Labs/phoenix-sdk/master/master_config.json";

export type MarketConfig = {
  name: string;
  marketId: string;
  baseToken: TokenConfig;
  quoteToken: TokenConfig;
};

export type TokenConfig = {
  name: string;
  symbol: string;
  mint: string;
  logoUri: string;
};

type BaseMarketConfig = {
  market: string;
  baseMint: string;
  quoteMint: string;
};

export type RawMarketConfig = Record<
  Cluster,
  {
    tokens: TokenConfig[];
    markets: BaseMarketConfig[];
  }
>;
export class Client {
  connection: Connection;
  cluster: Cluster;
  tokenConfigs: Map<string, TokenConfig>;
  marketStates: Map<string, MarketState>;
  marketMetadatas: Map<string, MarketMetadata>;
  marketConfigs: Map<string, MarketConfig>;
  clock: ClockData;

  private constructor({
    connection,
    cluster,
    tokenConfigs,
    marketStates,
    marketMetadatas,
    marketConfigs,
    clock,
  }: {
    connection: Connection;
    cluster: Cluster;
    tokenConfigs: Map<string, TokenConfig>;
    marketStates: Map<string, MarketState>;
    marketMetadatas: Map<string, MarketMetadata>;
    marketConfigs: Map<string, MarketConfig>;
    clock: ClockData;
  }) {
    this.connection = connection;
    this.cluster = cluster;
    this.tokenConfigs = tokenConfigs;
    this.marketStates = marketStates;
    this.marketMetadatas = marketMetadatas;
    this.marketConfigs = marketConfigs;
    this.clock = clock;
  }

  static async createFromConfig(
    connection: Connection,
    rawMarketConfigs: RawMarketConfig,
    skipInitialFetch = false,
    useZstd = true
  ): Promise<Client> {
    const cluster = await getClusterFromConnection(connection);
    const tokenConfigs = new Map<string, TokenConfig>();
    rawMarketConfigs[cluster].tokens.forEach((tokenConfig) => {
      tokenConfigs.set(tokenConfig.mint, tokenConfig);
    });

    const marketConfigs = new Map<string, MarketConfig>();
    const marketAddresses: PublicKey[] = [];
    rawMarketConfigs[cluster].markets.forEach((marketConfig) => {
      const baseToken = tokenConfigs.get(marketConfig.baseMint);
      const quoteToken = tokenConfigs.get(marketConfig.quoteMint);
      const marketAddress = marketConfig.market;
      if (baseToken !== undefined && quoteToken !== undefined) {
        marketConfigs.set(marketConfig.market, {
          marketId: marketAddress,
          name: `${baseToken.symbol}/${quoteToken.symbol}`,
          baseToken,
          quoteToken,
        });
        marketAddresses.push(new PublicKey(marketAddress));
      } else {
        throw new Error("Received invalid market config");
      }
    });

    const marketStates = new Map<string, MarketState>();
    const marketMetadatas = new Map<string, MarketMetadata>();
    const accountList = [];
    if (!skipInitialFetch) {
      accountList.push(...marketAddresses);
    }
    accountList.push(SYSVAR_CLOCK_PUBKEY);

    const accounts = useZstd
      ? await getConfirmedMarketsAndClockAccountsZstd(
          connection,
          marketAddresses
        )
      : await getConfirmedMarketsAndClockAccounts(connection, marketAddresses);

    const clockBuffer = accounts.pop();
    if (clockBuffer === undefined) {
      throw new Error("Unable to get clock");
    }

    const clock = deserializeClockData(clockBuffer);

    if (!skipInitialFetch) {
      const marketKeysAndData: Array<[PublicKey, Buffer]> = marketAddresses.map(
        (marketAddress, index) => {
          return [marketAddress, accounts[index] as Buffer];
        }
      );
      marketKeysAndData.forEach(([marketAddress, marketAccount]) => {
        const marketState = MarketState.load({
          address: marketAddress,
          buffer: marketAccount,
        });
        marketStates.set(marketAddress.toString(), marketState);
        const marketMetadata = MarketMetadata.fromMarketState(marketState);
        marketMetadatas.set(marketAddress.toString(), marketMetadata);
      });
    }

    return new Client({
      connection,
      cluster,
      tokenConfigs,
      clock,
      marketStates,
      marketMetadatas,
      marketConfigs,
    });
  }

  /**
   * Creates a new `PhoenixClient`
   *
   * @param connection The Solana `Connection` to use for the client
   * @param skipInitialFetch If true, skips the initial load of markets and tokens
   */
  static async create(
    connection: Connection,
    skipInitialFetch = false,
    configUrl = DEFAULT_CONFIG_URL
  ): Promise<Client> {
    const rawMarketConfigs: RawMarketConfig = await fetch(configUrl).then(
      (response) => {
        return response.json();
      }
    );
    return await Client.createFromConfig(
      connection,
      rawMarketConfigs,
      skipInitialFetch
    );
  }

  static async createWithoutConfig(
    connection: Connection,
    marketAddresses: PublicKey[],
    useZstd = true
  ): Promise<Client> {
    const cluster = await getClusterFromConnection(connection);
    const accounts = useZstd
      ? await getConfirmedMarketsAndClockAccountsZstd(
          connection,
          marketAddresses
        )
      : await getConfirmedMarketsAndClockAccounts(connection, marketAddresses);

    const clockBuffer = accounts.pop();
    if (clockBuffer === undefined) {
      throw new Error("Unable to get clock");
    }
    const clock = deserializeClockData(clockBuffer);

    if (accounts.length !== marketAddresses.length) {
      throw Error("Unable to get all market accounts");
    }

    const marketStates = new Map<string, MarketState>();
    const marketMetadatas = new Map<string, MarketMetadata>();
    const marketKeysAndData: Array<[PublicKey, Buffer]> = marketAddresses.map(
      (marketAddress, index) => {
        return [marketAddress, accounts[index] as Buffer];
      }
    );
    marketKeysAndData.forEach(([marketAddress, marketAccount]) => {
      const marketState = MarketState.load({
        address: marketAddress,
        buffer: marketAccount,
      });
      marketStates.set(marketAddress.toString(), marketState);
      const marketMetadata = MarketMetadata.fromMarketState(marketState);
      marketMetadatas.set(marketAddress.toString(), marketMetadata);
    });

    return new Client({
      connection,
      cluster,
      marketConfigs: new Map(),
      marketStates,
      marketMetadatas,
      tokenConfigs: new Map(),
      clock,
    });
  }

  static async createWithMarketAddresses(
    connection: Connection,
    marketAddresses: PublicKey[],
    configUrl = DEFAULT_CONFIG_URL,
    useZstd = true
  ): Promise<Client> {
    const cluster = await getClusterFromConnection(connection);

    const rawMarketConfigs: RawMarketConfig = await fetch(configUrl).then(
      (response) => {
        return response.json();
      }
    );
    const tokenConfigs = new Map<string, TokenConfig>();
    rawMarketConfigs[cluster].tokens.forEach((tokenConfig) => {
      tokenConfigs.set(tokenConfig.mint, tokenConfig);
    });

    const marketConfigs = new Map<string, MarketConfig>();
    rawMarketConfigs[cluster].markets.forEach((marketConfig) => {
      const baseToken = tokenConfigs.get(marketConfig.baseMint);
      const quoteToken = tokenConfigs.get(marketConfig.quoteMint);
      const marketAddress = marketConfig.market;
      if (baseToken !== undefined && quoteToken !== undefined) {
        marketConfigs.set(marketConfig.market, {
          marketId: marketAddress,
          name: `${baseToken.symbol}/${quoteToken.symbol}`,
          baseToken,
          quoteToken,
        });
      } else {
        throw new Error("Received invalid market config");
      }
    });

    const accounts = useZstd
      ? await getConfirmedMarketsAndClockAccountsZstd(
          connection,
          marketAddresses
        )
      : await getConfirmedMarketsAndClockAccounts(connection, marketAddresses);

    const clockBuffer = accounts.pop();
    if (clockBuffer === undefined) {
      throw new Error("Unable to get clock");
    }
    const clock = deserializeClockData(clockBuffer);

    const marketStates = new Map<string, MarketState>();
    const marketMetadatas = new Map<string, MarketMetadata>();
    const marketKeysAndData: Array<[PublicKey, Buffer]> = marketAddresses.map(
      (marketAddress, index) => {
        return [marketAddress, accounts[index] as Buffer];
      }
    );
    marketKeysAndData.forEach(([marketAddress, marketAccount]) => {
      const marketState = MarketState.load({
        address: marketAddress,
        buffer: marketAccount,
      });
      marketStates.set(marketAddress.toString(), marketState);
      const marketMetadata = MarketMetadata.fromMarketState(marketState);
      marketMetadatas.set(marketAddress.toString(), marketMetadata);
    });

    return new Client({
      connection,
      cluster,
      tokenConfigs,
      marketStates,
      marketConfigs,
      marketMetadatas,
      clock,
    });
  }

  /**
   * Add a market to the client. Useful for localnet as markets will not be loaded in by default.
   * @param marketAddress The `PublicKey` of the market account
   * @param forceReload If this is set to true, it will reload the market even if it already exists
   * @param useZstd If this is set to true, it will use zstd compression to get the market data. This is useful for fetching large accounts with a lot of repetitive data.
   */
  public async addMarket(
    marketAddress: string,
    forceReload = false,
    useZstd = true
  ) {
    const existingMarketState = this.marketStates.get(marketAddress);

    // If the market already exists, return
    if (existingMarketState !== undefined) {
      if (forceReload) {
        await this.refreshMarket(marketAddress);
      } else {
        console.log("Market already exists: ", marketAddress);
      }
      if (!this.marketMetadatas.has(marketAddress) || forceReload) {
        const marketMetadata =
          MarketMetadata.fromMarketState(existingMarketState);
        this.marketMetadatas.set(marketAddress, marketMetadata);
      }
      return;
    }

    const marketKey = new PublicKey(marketAddress);

    const [marketBuffer, clockBuffer] = useZstd
      ? await getConfirmedMarketsAndClockAccountsZstd(this.connection, [
          marketKey,
        ])
      : await getConfirmedMarketsAndClockAccounts(this.connection, [marketKey]);

    const marketState = MarketState.load({
      address: marketKey,
      buffer: marketBuffer,
    });

    this.marketStates.set(marketAddress, marketState);
    if (!this.marketMetadatas.has(marketAddress) || forceReload) {
      const marketMetadata = MarketMetadata.fromMarketState(marketState);
      this.marketMetadatas.set(marketAddress, marketMetadata);
    }

    this.reloadClockFromBuffer(clockBuffer);
  }

  /**
   * Refreshes the market data for all markets and the clock
   * @param useZstd If this is set to true, it will use zstd compression to get the market data. This is useful for fetching large accounts with a lot of repetitive data.
   */
  public async refreshAllMarkets(useZstd = true) {
    const marketKeys = Array.from(this.marketStates.keys()).map((market) => {
      return new PublicKey(market);
    });
    const accounts = useZstd
      ? await getConfirmedMarketsAndClockAccountsZstd(
          this.connection,
          marketKeys
        )
      : await getConfirmedMarketsAndClockAccounts(this.connection, marketKeys);

    const clockBuffer = accounts.pop();
    if (clockBuffer === undefined) {
      throw new Error("Unable to get clock");
    }
    this.reloadClockFromBuffer(clockBuffer);

    for (const [i, marketKey] of marketKeys.entries()) {
      const existingMarketState = this.marketStates.get(marketKey.toString());
      if (existingMarketState === undefined) {
        throw new Error("Market does not exist: " + marketKey.toBase58());
      }
      const buffer = accounts[i];
      if (buffer === undefined) {
        throw new Error("Unable to get market account data");
      }
      existingMarketState.reload(buffer);
    }
  }

  /**
   * Refreshes the market data and clock
   *
   * @param marketAddress The address of the market to refresh
   * @param useZstd If this is set to true, it will use zstd compression to get the market data. This is useful for fetching large accounts with a lot of repetitive data.
   * @returns The refreshed Market
   */
  public async refreshMarket(
    marketAddress: string | PublicKey,
    useZstd = true
  ): Promise<MarketState> {
    const marketKey = new PublicKey(marketAddress);
    const existingMarketState = this.marketStates.get(marketKey.toString());
    if (existingMarketState === undefined) {
      throw new Error("Market does not exist: " + marketKey.toBase58());
    }

    const [marketBuffer, clockBuffer] = useZstd
      ? await getConfirmedMarketsAndClockAccountsZstd(this.connection, [
          marketKey,
        ])
      : await getConfirmedMarketsAndClockAccounts(this.connection, [marketKey]);

    existingMarketState.reload(marketBuffer);
    if (clockBuffer === undefined) {
      throw new Error("Unable to get clock");
    }
    this.reloadClockFromBuffer(clockBuffer);
    return existingMarketState;
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
    const marketState = this.marketStates.get(marketAddress);
    if (!marketState) throw new Error("Market not found: " + marketAddress);
    return marketState.getLadder(
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
    const marketState = this.marketStates.get(marketAddress);
    if (!marketState) throw new Error("Market not found: " + marketAddress);
    return marketState.getUiLadder(
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
    const marketState = this.marketStates.get(marketAddress);
    if (!marketState) throw new Error("Market not found: " + marketAddress);
    return getMarketL3Book(
      marketState.data,
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
    const marketState = this.marketStates.get(marketAddress);
    if (!marketState) throw new Error("Market not found: " + marketAddress);
    return getMarketL3Book(
      marketState.data,
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
    const marketState = this.marketStates.get(marketAddress);
    if (!marketState) throw new Error("Market not found: " + marketAddress);
    return getMarketL3UiBook(
      marketState.data,
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
    const marketState = this.marketStates.get(marketAddress);
    if (!marketState) throw new Error("Market not found: " + marketAddress);
    return getMarketL3UiBook(
      marketState.data,
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
    const marketState = this.marketStates.get(marketAddress);
    if (!marketState) throw new Error("Market not found: " + marketAddress);
    return marketState.getExpectedOutAmount({
      side,
      inAmount,
      slot: this.clock.slot,
      unixTimestamp: this.clock.unixTimestamp,
    });
  }

  /**
   * Get a trader's base ATA for a given market
   *
   * @param trader The `PublicKey` of the trader account
   * @param marketAddress The `PublicKey` of the market account, as a string
   */
  public getBaseAccountKey(
    trader: PublicKey,
    marketAddress: string
  ): PublicKey {
    const marketMetadata = this.marketMetadatas.get(marketAddress);
    if (!marketMetadata) throw new Error("Market not found: " + marketAddress);
    return marketMetadata.getBaseAccountKey(trader);
  }

  /**
   * Get a trader's quote ATA for a given market
   *
   * @param trader The `PublicKey` of the trader account
   * @param marketAddress The `PublicKey` of the market account, as a string
   */
  public getQuoteAccountKey(
    trader: PublicKey,
    marketAddress: string
  ): PublicKey {
    const marketMetadata = this.marketMetadatas.get(marketAddress);
    if (!marketMetadata) throw new Error("Market not found: " + marketAddress);
    return marketMetadata.getQuoteAccountKey(trader);
  }

  /**
   * Get the quote vault address for a given market
   *
   * @param marketAddress The `PublicKey` of the market account, as a string
   */
  public getQuoteVaultKey(marketAddress: string): PublicKey {
    const marketMetadata = this.marketMetadatas.get(marketAddress);
    if (!marketMetadata) throw new Error("Market not found: " + marketAddress);
    return marketMetadata.getQuoteVaultKey();
  }

  /**
   * Get the base vault address for a given market
   *
   * @param marketAddress The `PublicKey` of the market account, as a string
   */
  public getBaseVaultKey(marketAddress: string): PublicKey {
    const marketMetadata = this.marketMetadatas.get(marketAddress);
    if (!marketMetadata) throw new Error("Market not found: " + marketAddress);
    return marketMetadata.getBaseVaultKey();
  }

  /**
   * Get a trader's seat account Pubkey for a given market
   *
   * @param trader The `PublicKey` of the trader account
   * @param marketAddress The `PublicKey` of the market account, as a string
   */
  public getSeatKey(trader: PublicKey, marketAddress: string): PublicKey {
    const marketMetadata = this.marketMetadatas.get(marketAddress);
    if (!marketMetadata) throw new Error("Market not found: " + marketAddress);
    return marketMetadata.getSeatAddress(trader);
  }

  /**
   * Unit conversion functions
   **/

  /**
   * Given a price in quote units per raw base unit, returns the price in ticks.
   *
   * Example: With a market tick size of 0.01, and a price of 1.23 quote units per raw base unit, the price in ticks is 123
   *
   * @param price The price to convert
   * @param marketAddress The `PublicKey` of the market account, as a string
   */
  public floatPriceToTicks(price: number, marketAddress: string): number {
    const marketMetadata = this.marketMetadatas.get(marketAddress);
    if (!marketMetadata) throw new Error("Market not found: " + marketAddress);
    return marketMetadata.floatPriceToTicks(price);
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
    const marketMetadata = this.marketMetadatas.get(marketAddress);
    if (!marketMetadata) throw new Error("Market not found: " + marketAddress);
    return marketMetadata.ticksToFloatPrice(ticks);
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
    const marketMetadata = this.marketMetadatas.get(marketAddress);
    if (!marketMetadata) throw new Error("Market not found: " + marketAddress);
    return marketMetadata.rawBaseUnitsToBaseLotsRoundedDown(rawBaseUnits);
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
    const marketMetadata = this.marketMetadatas.get(marketAddress);
    if (!marketMetadata) throw new Error("Market not found: " + marketAddress);
    return marketMetadata.rawBaseUnitsToBaseLotsRoundedUp(rawBaseUnits);
  }

  /**
   * Given a number of base atoms, returns the equivalent number of base lots.
   *
   * @param baseAtoms The amount of base atoms to convert
   * @param marketAddress The `PublicKey` of the market account, as a string
   */
  public baseAtomsToBaseLots(baseAtoms: number, marketAddress: string): number {
    const marketMetadata = this.marketMetadatas.get(marketAddress);
    if (!marketMetadata) throw new Error("Market not found: " + marketAddress);
    return marketMetadata.baseAtomsToBaseLots(baseAtoms);
  }

  /**
   * Given a number of base lots, returns the equivalent number of base atoms.
   *
   * @param baseLots The amount of base lots to convert
   * @param marketAddress The `PublicKey` of the market account, as a string
   */
  public baseLotsToBaseAtoms(baseLots: number, marketAddress: string): number {
    const marketMetadata = this.marketMetadatas.get(marketAddress);
    if (!marketMetadata) throw new Error("Market not found: " + marketAddress);
    return marketMetadata.baseLotsToBaseAtoms(baseLots);
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
    const marketMetadata = this.marketMetadatas.get(marketAddress);
    if (!marketMetadata) throw new Error("Market not found: " + marketAddress);
    return marketMetadata.quoteUnitsToQuoteLots(quoteUnits);
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
    const marketMetadata = this.marketMetadatas.get(marketAddress);
    if (!marketMetadata) throw new Error("Market not found: " + marketAddress);
    return marketMetadata.quoteAtomsToQuoteLots(quoteAtoms);
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
    const marketMetadata = this.marketMetadatas.get(marketAddress);
    if (!marketMetadata) throw new Error("Market not found: " + marketAddress);
    return marketMetadata.quoteLotsToQuoteAtoms(quoteLots);
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
    const marketMetadata = this.marketMetadatas.get(marketAddress);
    if (!marketMetadata) throw new Error("Market not found: " + marketAddress);
    return marketMetadata.baseAtomsToRawBaseUnits(baseAtoms);
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
    const marketMetadata = this.marketMetadatas.get(marketAddress);
    if (!marketMetadata) throw new Error("Market not found: " + marketAddress);
    return marketMetadata.quoteAtomsToQuoteUnits(quoteAtoms);
  }

  /**
   * Instruction builders
   **/

  /**
   * Creates a _CancelAllOrders_ instruction.
   *
   * @param marketAddress Market address string
   * @param trader Trader public key (defaults to client's wallet public key)
   *
   * @category Instructions
   */
  public createCancelAllOrdersInstruction(
    marketAddress: string,
    trader: PublicKey
  ): TransactionInstruction {
    const marketMetadata = this.marketMetadatas.get(marketAddress);
    if (!marketMetadata) throw new Error("Market not found: " + marketAddress);
    return marketMetadata.createCancelAllOrdersInstruction(trader);
  }

  /**
   * Creates a _CancelAllOrdersWithFreeFunds_ instruction.
   *
   * @param marketAddress Market address string
   * @param trader Trader public key (defaults to client's wallet public key)
   * @category Instructions
   */
  public createCancelAllOrdersWithFreeFundsInstruction(
    marketAddress: string,
    trader: PublicKey
  ): TransactionInstruction {
    const marketMetadata = this.marketMetadatas.get(marketAddress);
    if (!marketMetadata) throw new Error("Market not found: " + marketAddress);
    return marketMetadata.createCancelAllOrdersWithFreeFundsInstruction(trader);
  }

  /**
   * Creates a _CancelMultipleOrdersById_ instruction.
   *
   * @param args to provide as instruction data to the program
   * @param marketAddress Market address string
   * @param trader Trader public key
   *
   * @category Instructions
   * @category CancelMultipleOrdersById
   */
  public createCancelMultipleOrdersByIdInstruction(
    args: CancelMultipleOrdersByIdInstructionArgs,
    marketAddress: string,
    trader: PublicKey
  ): TransactionInstruction {
    const marketMetadata = this.marketMetadatas.get(marketAddress);
    if (!marketMetadata) throw new Error("Market not found: " + marketAddress);
    return marketMetadata.createCancelMultipleOrdersByIdInstruction(
      args,
      trader
    );
  }

  /**
   * Creates a _CancelMultipleOrdersByIdWithFreeFunds_ instruction.
   *
   * @param args to provide as instruction data to the program
   * @param marketAddress Market address string
   * @param trader Trader public key
   *
   * @category Instructions
   */
  public createCancelMultipleOrdersByIdWithFreeFundsInstruction(
    args: CancelMultipleOrdersByIdWithFreeFundsInstructionArgs,
    marketAddress: string,
    trader: PublicKey
  ): TransactionInstruction {
    const marketMetadata = this.marketMetadatas.get(marketAddress);
    if (!marketMetadata) throw new Error("Market not found: " + marketAddress);
    return marketMetadata.createCancelMultipleOrdersByIdWithFreeFundsInstruction(
      args,
      trader
    );
  }

  /**
   * Creates a _CancelUpTo_ instruction.
   *
   * @param args to provide as instruction data to the program
   * @param marketAddress Market address string
   * @param trader Trader public key (defaults to client's wallet public key)
   *
   * @category Instructions
   */
  public createCancelUpToInstruction(
    args: CancelUpToInstructionArgs,
    marketAddress: string,
    trader: PublicKey
  ): TransactionInstruction {
    const marketMetadata = this.marketMetadatas.get(marketAddress);
    if (!marketMetadata) throw new Error("Market not found: " + marketAddress);
    return marketMetadata.createCancelUpToInstruction(args, trader);
  }

  /**
   * Creates a _CancelUpToWithFreeFunds_ instruction.
   *
   * @param args to provide as instruction data to the program
   * @param marketAddress Market address string
   * @param trader Trader public key
   *
   * @category Instructions
   */
  public createCancelUpToWithFreeFundsInstruction(
    args: CancelUpToWithFreeFundsInstructionArgs,
    marketAddress: string,
    trader: PublicKey
  ): TransactionInstruction {
    const marketMetadata = this.marketMetadatas.get(marketAddress);
    if (!marketMetadata) throw new Error("Market not found: " + marketAddress);
    return marketMetadata.createCancelUpToWithFreeFundsInstruction(
      args,
      trader
    );
  }

  /**
   * Creates a _DepositFunds_ instruction.
   *
   * @param args to provide as instruction data to the program
   * @param marketAddress Market address string
   * @param trader Trader public key
   *
   * @category Instructions
   */
  public createDepositFundsInstruction(
    args: DepositFundsInstructionArgs,
    marketAddress: string,
    trader: PublicKey
  ): TransactionInstruction {
    const marketMetadata = this.marketMetadatas.get(marketAddress);
    if (!marketMetadata) throw new Error("Market not found: " + marketAddress);
    return marketMetadata.createDepositFundsInstruction(args, trader);
  }

  /**
   * Creates a _PlaceLimitOrder_ instruction.
   *
   * @param orderPacket to provide as instruction data to the program
   * @param marketAddress Market address string
   * @param trader Trader public key
   *
   * @category Instructions
   */
  public createPlaceLimitOrderInstruction(
    orderPacket: OrderPacket,
    marketAddress: string,
    trader: PublicKey
  ): TransactionInstruction {
    const marketMetadata = this.marketMetadatas.get(marketAddress);
    if (!marketMetadata) throw new Error("Market not found: " + marketAddress);
    return marketMetadata.createPlaceLimitOrderInstruction(orderPacket, trader);
  }

  /**
   * Creates a _PlaceLimitOrderWithFreeFunds_ instruction.
   *
   * @param orderPacket to provide as instruction data to the program
   * @param marketAddress Market address string
   * @param trader Trader public key
   *
   * @category Instructions
   */
  public createPlaceLimitOrderWithFreeFundsInstruction(
    orderPacket: OrderPacket,
    marketAddress: string,
    trader: PublicKey
  ) {
    const marketMetadata = this.marketMetadatas.get(marketAddress);
    if (!marketMetadata) throw new Error("Market not found: " + marketAddress);
    return marketMetadata.createPlaceLimitOrderWithFreeFundsInstruction(
      orderPacket,
      trader
    );
  }

  /**
   * Creates a _PlaceMultiplePostOnlyOrders_ instruction.
   *
   * @param args to provide as instruction data to the program
   * @param marketAddress Market address string
   * @param trader Trader public key
   *
   * @category Instructions
   */
  public createPlaceMultiplePostOnlyOrdersInstruction(
    args: PlaceMultiplePostOnlyOrdersInstructionArgs,
    marketAddress: string,
    trader: PublicKey
  ): TransactionInstruction {
    const marketMetadata = this.marketMetadatas.get(marketAddress);
    if (!marketMetadata) throw new Error("Market not found: " + marketAddress);
    return marketMetadata.createPlaceMultiplePostOnlyOrdersInstruction(
      args,
      trader
    );
  }

  /**
   * Creates a _PlaceMultiplePostOnlyOrdersWithFreeFunds_ instruction.
   *
   * @param args to provide as instruction data to the program
   * @param marketAddress Market address string
   * @param trader Trader public key
   *
   * @category Instructions
   */
  public createPlaceMultiplePostOnlyOrdersInstructionWithFreeFunds(
    args: PlaceMultiplePostOnlyOrdersInstructionArgs,
    marketAddress: string,
    trader: PublicKey
  ): TransactionInstruction {
    const marketMetadata = this.marketMetadatas.get(marketAddress);
    if (!marketMetadata) throw new Error("Market not found: " + marketAddress);
    return marketMetadata.createPlaceMultiplePostOnlyOrdersInstructionWithFreeFunds(
      args,
      trader
    );
  }

  /**
   * Creates a _ReduceOrder_ instruction.
   *
   * @param args to provide as instruction data to the program
   * @param marketAddress Market address string
   * @param trader Trader public key
   *
   * @category Instructions
   */
  public createReduceOrderInstruction(
    args: ReduceOrderInstructionArgs,
    marketAddress: string,
    trader: PublicKey
  ) {
    const marketMetadata = this.marketMetadatas.get(marketAddress);
    if (!marketMetadata) throw new Error("Market not found: " + marketAddress);
    return marketMetadata.createReduceOrderInstruction(args, trader);
  }

  /**
   * Creates a _ReduceOrderWithFreeFunds_ instruction.
   *
   * @param args to provide as instruction data to the program
   * @param marketAddress Market address string
   * @param trader Trader public key
   *
   * @category Instructions
   */
  public createReduceOrderWithFreeFundsInstruction(
    args: ReduceOrderWithFreeFundsInstructionArgs,
    marketAddress: string,
    trader: PublicKey
  ) {
    const marketMetadata = this.marketMetadatas.get(marketAddress);
    if (!marketMetadata) throw new Error("Market not found: " + marketAddress);
    return marketMetadata.createReduceOrderWithFreeFundsInstruction(
      args,
      trader
    );
  }

  /**
   * Creates a _RequestSeat_ instruction.
   *
   * @param marketAddress Market address string
   * @param payer Payer public key
   * @param trader Trader public key
   *
   * @category Instructions
   */
  public createRequestSeatInstruction(
    marketAddress: string,
    payer: PublicKey,
    trader: PublicKey
  ) {
    if (!trader) {
      trader = payer;
    }

    const marketMetadata = this.marketMetadatas.get(marketAddress);
    if (!marketMetadata) throw new Error("Market not found: " + marketAddress);
    return marketMetadata.createRequestSeatInstruction(payer, trader);
  }

  /**
   * Creates a _Swap_ instruction.
   *
   * @param orderPacket to provide as instruction data to the program
   * @param marketAddress Market address string
   * @param trader Trader public key
   *
   * @category Instructions
   */
  public createSwapInstruction(
    orderPacket: OrderPacket,
    marketAddress: string,
    trader: PublicKey
  ): TransactionInstruction {
    const marketMetadata = this.marketMetadatas.get(marketAddress);
    if (!marketMetadata) throw new Error("Market not found: " + marketAddress);
    return marketMetadata.createSwapInstruction(orderPacket, trader);
  }

  /**
   * Creates a _SwapWithFreeFunds_ instruction.
   *
   * @param orderPacket to provide as instruction data to the program
   * @param marketAddress Market address string
   * @param trader Trader public key
   *
   * @category Instructions
   */
  public createSwapWithFreeFundsInstruction(
    orderPacket: OrderPacket,
    marketAddress: string,
    trader: PublicKey
  ) {
    const marketMetadata = this.marketMetadatas.get(marketAddress);
    if (!marketMetadata) throw new Error("Market not found: " + marketAddress);
    return marketMetadata.createSwapWithFreeFundsInstruction(
      orderPacket,
      trader
    );
  }

  /**
   * Creates a _WithdrawFunds_ instruction.
   *
   * @param args to provide as instruction data to the program
   * @param marketAddress Market address string
   * @param trader Trader public key
   *
   * @category Instructions
   */
  public createWithdrawFundsInstruction(
    args: WithdrawFundsInstructionArgs,
    marketAddress: string,
    trader: PublicKey
  ): TransactionInstruction {
    const marketMetadata = this.marketMetadatas.get(marketAddress);
    if (!marketMetadata) throw new Error("Market not found: " + marketAddress);
    return marketMetadata.createWithdrawFundsInstruction(args, trader);
  }

  /**
   * Returns an instruction to place a limit order on a market, using a LimitOrderPacketTemplate, which takes in human-friendly units
   * @param marketAddress The market's address
   * @param trader The trader's address
   * @param limitOrderTemplate The order packet template to place
   * @returns
   */
  public getLimitOrderInstructionfromTemplate(
    marketAddress: string,
    trader: PublicKey,
    limitOrderTemplate: LimitOrderTemplate
  ): TransactionInstruction {
    const marketMetadata = this.marketMetadatas.get(marketAddress);
    if (!marketMetadata) throw new Error("Market not found: " + marketAddress);

    return marketMetadata.getLimitOrderInstructionfromTemplate(
      trader,
      limitOrderTemplate
    );
  }

  /**
   * Returns an instruction to place a post only on a market, using a PostOnlyOrderPacketTemplate, which takes in human-friendly units.
   * @param marketAddress The market's address
   * @param trader The trader's address
   * @param postOnlyOrderTemplate The order packet template to place
   * @returns
   */
  public getPostOnlyOrderInstructionfromTemplate(
    marketAddress: string,
    trader: PublicKey,
    postOnlyOrderTemplate: PostOnlyOrderTemplate
  ): TransactionInstruction {
    const marketMetadata = this.marketMetadatas.get(marketAddress);
    if (!marketMetadata) throw new Error("Market not found: " + marketAddress);

    return marketMetadata.getPostOnlyOrderInstructionfromTemplate(
      trader,
      postOnlyOrderTemplate
    );
  }

  /**
   * Returns an instruction to place an immediate or cancel on a market, using a ImmediateOrCancelPacketTemplate, which takes in human-friendly units.
   * @param marketAddress The market's address
   * @param trader The trader's address
   * @param immediateOrCancelOrderTemplate The order packet template to place
   * @returns
   */
  public getImmediateOrCancelOrderIxfromTemplate(
    marketAddress: string,
    trader: PublicKey,
    immediateOrCancelOrderTemplate: ImmediateOrCancelOrderTemplate
  ): TransactionInstruction {
    const marketMetadata = this.marketMetadatas.get(marketAddress);
    if (!marketMetadata) throw new Error("Market not found: " + marketAddress);

    return marketMetadata.getImmediateOrCancelOrderInstructionfromTemplate(
      trader,
      immediateOrCancelOrderTemplate
    );
  }
}
