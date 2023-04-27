import { PublicKey, TransactionInstruction } from "@solana/web3.js";
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
  CancelMultipleOrdersByIdInstructionArgs,
  CancelMultipleOrdersByIdWithFreeFundsInstructionArgs,
  CancelUpToInstructionArgs,
  CancelUpToWithFreeFundsInstructionArgs,
  DepositFundsInstructionArgs,
  PROGRAM_ID,
  PlaceLimitOrderInstructionArgs,
  PlaceLimitOrderWithFreeFundsInstructionArgs,
  PlaceMultiplePostOnlyOrdersInstructionArgs,
  ReduceOrderInstructionArgs,
  ReduceOrderWithFreeFundsInstructionArgs,
  SwapInstructionArgs,
  SwapWithFreeFundsInstructionArgs,
  TokenConfig,
  WithdrawFundsInstructionArgs,
  createCancelAllOrdersInstruction,
  createCancelAllOrdersWithFreeFundsInstruction,
  createCancelMultipleOrdersByIdInstruction,
  createCancelMultipleOrdersByIdWithFreeFundsInstruction,
  createCancelUpToInstruction,
  createCancelUpToWithFreeFundsInstruction,
  createDepositFundsInstruction,
  createPlaceLimitOrderInstruction,
  createPlaceLimitOrderWithFreeFundsInstruction,
  createPlaceMultiplePostOnlyOrdersInstruction,
  createPlaceMultiplePostOnlyOrdersWithFreeFundsInstruction,
  createReduceOrderInstruction,
  createReduceOrderWithFreeFundsInstruction,
  createRequestSeatInstruction,
  createSwapInstruction,
  createSwapWithFreeFundsInstruction,
  createWithdrawFundsInstruction,
  getExpectedOutAmountRouter,
  getLogAuthority,
  getRequiredInAmountRouter,
} from "./index";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

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

export type LadderLevel = {
  priceInTicks: BN;
  sizeInBaseLots: BN;
};

export type Ladder = {
  bids: Array<LadderLevel>;
  asks: Array<LadderLevel>;
};

export type L3Order = {
  priceInTicks: BN;
  side: Side;
  sizeInBaseLots: BN;
  makerPubkey: string;
  orderSequenceNumber: BN;
};

export type L3UiOrder = {
  price: number;
  side: Side;
  size: number;
  makerPubkey: string;
  orderSequenceNumber: string;
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
   * Get a trader's base ATA for a given market
   *
   * @param trader The `PublicKey` of the trader account
   */
  public getBaseAccountKey(trader: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [
        trader.toBuffer(),
        TOKEN_PROGRAM_ID.toBuffer(),
        this.data.header.baseParams.mintKey.toBuffer(),
      ],
      ASSOCIATED_TOKEN_PROGRAM_ID
    )[0];
  }

  /**
   * Get a trader's quote ATA for a given market
   *
   * @param trader The `PublicKey` of the trader account
   */
  public getQuoteAccountKey(trader: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [
        trader.toBuffer(),
        TOKEN_PROGRAM_ID.toBuffer(),
        this.data.header.quoteParams.mintKey.toBuffer(),
      ],
      ASSOCIATED_TOKEN_PROGRAM_ID
    )[0];
  }

  /**
   * Get the quote vault token account address for a given market
   */
  public getQuoteVaultKey(): PublicKey {
    return this.data.header.quoteParams.vaultKey;
  }

  /**
   * Get the base vault token account address for a given market
   */
  public getBaseVaultKey(): PublicKey {
    return this.data.header.baseParams.vaultKey;
  }

  /**
   * Get a trader's seat account address
   *
   * @param trader The `PublicKey` of the trader account
   */
  public getSeatKey(trader: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("seat"), this.address.toBuffer(), trader.toBuffer()],
      PROGRAM_ID
    )[0];
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

  /**
   * Given a price in quote units per raw base unit, returns the price in ticks.
   *
   * Example: With a market tick size of 0.01, and a price of 1.23 quote units per raw base unit, the price in ticks is 123
   *
   * @param price The price to convert
   */
  public floatPriceToTicks(price: number): number {
    return Math.round(
      (price *
        this.data.header.rawBaseUnitsPerBaseUnit *
        10 ** this.quoteToken.data.decimals) /
        (this.data.quoteLotsPerBaseUnitPerTick *
          toNum(this.data.header.quoteLotSize))
    );
  }

  /**
   * Given a price in ticks, returns the price in quote units per raw base unit.
   *
   * Example: With a market tick size of 0.01, and a price of 123 ticks, the price in quote units per raw base unit is 1.23
   *
   * @param ticks The price in ticks to convert
   */
  public ticksToFloatPrice(ticks: number): number {
    return (
      (ticks *
        this.data.quoteLotsPerBaseUnitPerTick *
        toNum(this.data.header.quoteLotSize)) /
      (10 ** this.quoteToken.data.decimals *
        this.data.header.rawBaseUnitsPerBaseUnit)
    );
  }

  /**
   * Given a number of raw base units, returns the equivalent number of base lots (rounded down).
   *
   * @param rawBaseUnits The amount of raw base units to convert
   */
  public rawBaseUnitsToBaseLotsRoundedDown(rawBaseUnits: number): number {
    const baseUnits = rawBaseUnits / this.data.header.rawBaseUnitsPerBaseUnit;
    return Math.floor(baseUnits * this.data.baseLotsPerBaseUnit);
  }

  /**
   * Given a number of raw base units, returns the equivalent number of base lots (rounded up).
   *
   * @param rawBaseUnits The amount of raw base units to convert
   */
  public rawBaseUnitsToBaseLotsRoundedUp(rawBaseUnits: number): number {
    const baseUnits = rawBaseUnits / this.data.header.rawBaseUnitsPerBaseUnit;
    return Math.ceil(baseUnits * this.data.baseLotsPerBaseUnit);
  }

  /**
   * Given a number of base atoms, returns the equivalent number of base lots.
   *
   * @param baseAtoms The amount of base atoms to convert
   */
  public baseAtomsToBaseLots(baseAtoms: number): number {
    return Math.round(baseAtoms / toNum(this.data.header.baseLotSize));
  }

  /**
   * Given a number of base lots, returns the equivalent number of base atoms.
   *
   * @param baseLots The amount of base lots to convert
   */
  public baseLotsToBaseAtoms(baseLots: number): number {
    return baseLots * toNum(this.data.header.baseLotSize);
  }

  /**
   * Given a number of quote units, returns the equivalent number of quote lots.
   *
   * @param quoteUnits The amount of quote units to convert
   */
  public quoteUnitsToQuoteLots(quoteUnits: number): number {
    return Math.round(
      (quoteUnits * 10 ** this.quoteToken.data.decimals) /
        toNum(this.data.header.quoteLotSize)
    );
  }

  /**
   * Given a number of quote atoms, returns the equivalent number of quote lots.
   *
   * @param quoteAtoms The amount of quote atoms to convert
   */
  public quoteAtomsToQuoteLots(quoteAtoms: number): number {
    return Math.round(quoteAtoms / toNum(this.data.header.quoteLotSize));
  }

  /**
   * Given a number of quote lots, returns the equivalent number of quote atoms.
   *
   * @param quoteLots The amount of quote lots to convert
   */
  public quoteLotsToQuoteAtoms(quoteLots: number): number {
    return quoteLots * toNum(this.data.header.quoteLotSize);
  }

  /**
   * Given a number of base atoms, returns the equivalent number of raw base units.
   *
   * @param baseAtoms The amount of base atoms to convert
   */
  public baseAtomsToRawBaseUnits(baseAtoms: number): number {
    return baseAtoms / 10 ** this.baseToken.data.decimals;
  }

  /**
   * Given a number of quote atoms, returns the equivalent number of quote units.
   *
   * @param quoteAtoms The amount of quote atoms to convert
   */
  public quoteAtomsToQuoteUnits(quoteAtoms: number): number {
    return quoteAtoms / 10 ** this.quoteToken.data.decimals;
  }

  /**
   * Instruction builders
   **/

  /**
   * Creates a _CancelAllOrders_ instruction.
   *
   * @param trader Trader public key (defaults to client's wallet public key)
   *
   * @category Instructions
   */
  public createCancelAllOrdersInstruction(
    trader: PublicKey
  ): TransactionInstruction {
    const marketKey = this.address;
    return createCancelAllOrdersInstruction({
      phoenixProgram: PROGRAM_ID,
      logAuthority: getLogAuthority(),
      market: marketKey,
      trader,
      baseAccount: this.getBaseAccountKey(trader),
      quoteAccount: this.getQuoteAccountKey(trader),
      baseVault: this.getBaseVaultKey(),
      quoteVault: this.getQuoteVaultKey(),
    });
  }

  /**
   * Creates a _CancelAllOrdersWithFreeFunds_ instruction.
   *
   * @param trader Trader public key (defaults to client's wallet public key)
   * @category Instructions
   */
  public createCancelAllOrdersWithFreeFundsInstruction(
    trader: PublicKey
  ): TransactionInstruction {
    return createCancelAllOrdersWithFreeFundsInstruction({
      phoenixProgram: PROGRAM_ID,
      logAuthority: getLogAuthority(),
      market: this.address,
      trader,
    });
  }

  /**
   * Creates a _CancelMultipleOrdersById_ instruction.
   *
   * @param args to provide as instruction data to the program
   * @param trader Trader public key (defaults to client's wallet public key)
   *
   * @category Instructions
   * @category CancelMultipleOrdersById
   */
  public createCancelMultipleOrdersByIdInstruction(
    args: CancelMultipleOrdersByIdInstructionArgs,
    trader: PublicKey
  ): TransactionInstruction {
    return createCancelMultipleOrdersByIdInstruction(
      {
        phoenixProgram: PROGRAM_ID,
        logAuthority: getLogAuthority(),
        market: this.address,
        trader,
        baseAccount: this.getBaseAccountKey(trader),
        quoteAccount: this.getQuoteAccountKey(trader),
        baseVault: this.getBaseVaultKey(),
        quoteVault: this.getQuoteVaultKey(),
      },
      args
    );
  }

  /**
   * Creates a _CancelMultipleOrdersByIdWithFreeFunds_ instruction.
   *
   * @param args to provide as instruction data to the program
   * @param trader Trader public key (defaults to client's wallet public key)
   *
   * @category Instructions
   */
  public createCancelMultipleOrdersByIdWithFreeFundsInstruction(
    args: CancelMultipleOrdersByIdWithFreeFundsInstructionArgs,
    trader: PublicKey
  ): TransactionInstruction {
    return createCancelMultipleOrdersByIdWithFreeFundsInstruction(
      {
        phoenixProgram: PROGRAM_ID,
        logAuthority: getLogAuthority(),
        market: this.address,
        trader,
      },
      args
    );
  }

  /**
   * Creates a _CancelUpTo_ instruction.
   *
   * @param args to provide as instruction data to the program
   * @param trader Trader public key (defaults to client's wallet public key)
   *
   * @category Instructions
   */
  public createCancelUpToInstruction(
    args: CancelUpToInstructionArgs,
    trader: PublicKey
  ): TransactionInstruction {
    return createCancelUpToInstruction(
      {
        phoenixProgram: PROGRAM_ID,
        logAuthority: getLogAuthority(),
        market: this.address,
        trader,
        baseAccount: this.getBaseAccountKey(trader),
        quoteAccount: this.getQuoteAccountKey(trader),
        baseVault: this.getBaseVaultKey(),
        quoteVault: this.getQuoteVaultKey(),
      },
      args
    );
  }

  /**
   * Creates a _CancelUpToWithFreeFunds_ instruction.
   *
   * @param args to provide as instruction data to the program
   * @param trader Trader public key (defaults to client's wallet public key)
   *
   * @category Instructions
   */
  public createCancelUpToWithFreeFundsInstruction(
    args: CancelUpToWithFreeFundsInstructionArgs,
    trader?: PublicKey
  ): TransactionInstruction {
    return createCancelUpToWithFreeFundsInstruction(
      {
        phoenixProgram: PROGRAM_ID,
        logAuthority: getLogAuthority(),
        market: this.address,
        trader,
      },
      args
    );
  }

  /**
   * Creates a _DepositFunds_ instruction.
   *
   * @param args to provide as instruction data to the program
   * @param trader Trader public key
   *
   * @category Instructions
   */
  public createDepositFundsInstruction(
    args: DepositFundsInstructionArgs,
    trader?: PublicKey
  ): TransactionInstruction {
    return createDepositFundsInstruction(
      {
        phoenixProgram: PROGRAM_ID,
        logAuthority: getLogAuthority(),
        market: this.address,
        trader,
        seat: this.getSeatKey(trader),
        baseAccount: this.getBaseAccountKey(trader),
        quoteAccount: this.getQuoteAccountKey(trader),
        baseVault: this.getBaseVaultKey(),
        quoteVault: this.getQuoteVaultKey(),
      },
      args
    );
  }

  /**
   * Creates a _PlaceLimitOrder_ instruction.
   *
   * @param args to provide as instruction data to the program
   * @param trader Trader public key
   *
   * @category Instructions
   */
  public createPlaceLimitOrderInstruction(
    args: PlaceLimitOrderInstructionArgs,
    trader?: PublicKey
  ): TransactionInstruction {
    return createPlaceLimitOrderInstruction(
      {
        phoenixProgram: PROGRAM_ID,
        logAuthority: getLogAuthority(),
        market: this.address,
        trader,
        seat: this.getSeatKey(trader),
        baseAccount: this.getBaseAccountKey(trader),
        quoteAccount: this.getQuoteAccountKey(trader),
        baseVault: this.getBaseVaultKey(),
        quoteVault: this.getQuoteVaultKey(),
      },
      args
    );
  }

  /**
   * Creates a _PlaceLimitOrderWithFreeFunds_ instruction.
   *
   * @param args to provide as instruction data to the program
   * @param trader Trader public key
   *
   * @category Instructions
   */
  public createPlaceLimitOrderWithFreeFundsInstruction(
    args: PlaceLimitOrderWithFreeFundsInstructionArgs,
    trader?: PublicKey
  ) {
    return createPlaceLimitOrderWithFreeFundsInstruction(
      {
        phoenixProgram: PROGRAM_ID,
        logAuthority: getLogAuthority(),
        market: this.address,
        trader,
        seat: this.getSeatKey(trader),
      },
      args
    );
  }

  /**
   * Creates a _PlaceMultiplePostOnlyOrders_ instruction.
   *
   * @param args to provide as instruction data to the program
   * @param trader Trader public key
   *
   * @category Instructions
   */
  public createPlaceMultiplePostOnlyOrdersInstruction(
    args: PlaceMultiplePostOnlyOrdersInstructionArgs,
    trader?: PublicKey
  ): TransactionInstruction {
    return createPlaceMultiplePostOnlyOrdersInstruction(
      {
        phoenixProgram: PROGRAM_ID,
        logAuthority: getLogAuthority(),
        market: this.address,
        trader,
        seat: this.getSeatKey(trader),
        baseAccount: this.getBaseAccountKey(trader),
        quoteAccount: this.getQuoteAccountKey(trader),
        baseVault: this.getBaseVaultKey(),
        quoteVault: this.getQuoteVaultKey(),
      },
      args
    );
  }

  /**
   * Creates a _PlaceMultiplePostOnlyOrdersWithFreeFunds_ instruction.
   *
   * @param args to provide as instruction data to the program
   * @param trader Trader public key
   *
   * @category Instructions
   */
  public createPlaceMultiplePostOnlyOrdersInstructionWithFreeFunds(
    args: PlaceMultiplePostOnlyOrdersInstructionArgs,
    trader?: PublicKey
  ): TransactionInstruction {
    return createPlaceMultiplePostOnlyOrdersWithFreeFundsInstruction(
      {
        phoenixProgram: PROGRAM_ID,
        logAuthority: getLogAuthority(),
        market: this.address,
        trader,
        seat: this.getSeatKey(trader),
      },
      args
    );
  }

  /**
   * Creates a _ReduceOrder_ instruction.
   *
   * @param args to provide as instruction data to the program
   * @param trader Trader public key
   *
   * @category Instructions
   */
  public createReduceOrderInstruction(
    args: ReduceOrderInstructionArgs,
    trader: PublicKey
  ) {
    return createReduceOrderInstruction(
      {
        phoenixProgram: PROGRAM_ID,
        logAuthority: getLogAuthority(),
        market: this.address,
        trader,
        baseAccount: this.getBaseAccountKey(trader),
        quoteAccount: this.getQuoteAccountKey(trader),
        baseVault: this.getBaseVaultKey(),
        quoteVault: this.getQuoteVaultKey(),
      },
      args
    );
  }

  /**
   * Creates a _ReduceOrderWithFreeFunds_ instruction.
   *
   * @param args to provide as instruction data to the program
   * @param trader Trader public key
   *
   * @category Instructions
   */
  public createReduceOrderWithFreeFundsInstruction(
    args: ReduceOrderWithFreeFundsInstructionArgs,
    trader: PublicKey
  ) {
    return createReduceOrderWithFreeFundsInstruction(
      {
        phoenixProgram: PROGRAM_ID,
        logAuthority: getLogAuthority(),
        market: this.address,
        trader,
      },
      args
    );
  }

  /**
   * Creates a _RequestSeat_ instruction.
   *
   * @param payer Payer public key
   * @param trader Trader public key
   *
   * @category Instructions
   */
  public createRequestSeatInstruction(payer: PublicKey, trader: PublicKey) {
    return createRequestSeatInstruction({
      phoenixProgram: PROGRAM_ID,
      logAuthority: getLogAuthority(),
      market: this.address,
      payer,
      seat: this.getSeatKey(trader),
    });
  }

  /**
   * Creates a _Swap_ instruction.
   *
   * @param args to provide as instruction data to the program
   * @param trader Trader public key
   *
   * @category Instructions
   */
  public createSwapInstruction(
    args: SwapInstructionArgs,
    trader: PublicKey
  ): TransactionInstruction {
    return createSwapInstruction(
      {
        phoenixProgram: PROGRAM_ID,
        logAuthority: getLogAuthority(),
        market: this.address,
        trader,
        baseAccount: this.getBaseAccountKey(trader),
        quoteAccount: this.getQuoteAccountKey(trader),
        baseVault: this.getBaseVaultKey(),
        quoteVault: this.getQuoteVaultKey(),
      },
      args
    );
  }

  /**
   * Creates a _SwapWithFreeFunds_ instruction.
   *
   * @param args to provide as instruction data to the program
   * @param trader Trader public key
   *
   * @category Instructions
   */
  public createSwapWithFreeFundsInstruction(
    args: SwapWithFreeFundsInstructionArgs,
    trader: PublicKey
  ) {
    return createSwapWithFreeFundsInstruction(
      {
        phoenixProgram: PROGRAM_ID,
        logAuthority: getLogAuthority(),
        market: this.address,
        trader,
        seat: this.getSeatKey(trader),
      },
      args
    );
  }

  /**
   * Creates a _WithdrawFunds_ instruction.
   *
   * @param args to provide as instruction data to the program
   * @param trader Trader public key
   *
   * @category Instructions
   */
  public createWithdrawFundsInstruction(
    args: WithdrawFundsInstructionArgs,
    trader?: PublicKey
  ): TransactionInstruction {
    return createWithdrawFundsInstruction(
      {
        phoenixProgram: PROGRAM_ID,
        logAuthority: getLogAuthority(),
        market: this.address,
        trader,
        baseAccount: this.getBaseAccountKey(trader),
        quoteAccount: this.getQuoteAccountKey(trader),
        baseVault: this.getBaseVaultKey(),
        quoteVault: this.getQuoteVaultKey(),
      },
      args
    );
  }
}
