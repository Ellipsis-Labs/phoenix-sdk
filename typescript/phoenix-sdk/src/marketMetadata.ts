import { MarketState } from "./market";
import { MarketSizeParams, OrderPacket, TokenParams } from "./types";
import { getSeatAddress, toNum } from "./utils";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  CancelMultipleOrdersByIdInstructionArgs,
  CancelMultipleOrdersByIdWithFreeFundsInstructionArgs,
  CancelUpToInstructionArgs,
  CancelUpToWithFreeFundsInstructionArgs,
  DepositFundsInstructionArgs,
  LimitOrderTemplate,
  PROGRAM_ID,
  PlaceMultiplePostOnlyOrdersInstructionArgs,
  PostOnlyOrderTemplate,
  ImmediateOrCancelOrderTemplate,
  ReduceOrderInstructionArgs,
  ReduceOrderWithFreeFundsInstructionArgs,
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
  getImmediateOrCancelOrderPacket,
  getLimitOrderPacket,
  getLogAuthority,
  getPostOnlyOrderPacket,
} from "./index";

export class MarketMetadata {
  // The market's address
  address: PublicKey;

  marketSizeParams: MarketSizeParams;
  baseParams: TokenParams;
  baseLotSize: number;
  quoteParams: TokenParams;
  quoteLotSize: number;
  tickSizeInQuoteAtomsPerBaseUnit: number;
  rawBaseUnitsPerBaseUnit: number;

  // The number of base lots per base unit
  baseLotsPerBaseUnit: number;

  // Tick size of the market, in quote lots per base unit
  // Note that the header contains tick size in quote atoms per base unit
  quoteLotsPerBaseUnitPerTick: number;

  // The number of decimal places to display for the price
  priceDecimalPlaces: number;

  // Taker fee in basis points
  takerFeeBps: number;

  constructor({
    address,
    marketSizeParams,
    baseParams,
    baseLotSize,
    quoteParams,
    quoteLotSize,
    tickSizeInQuoteAtomsPerBaseUnit,
    rawBaseUnitsPerBaseUnit,
    baseLotsPerBaseUnit,
    quoteLotsPerBaseUnitPerTick,
    priceDecimalPlaces,
    takerFeeBps,
  }: {
    address: PublicKey;
    marketSizeParams: MarketSizeParams;
    baseParams: TokenParams;
    baseLotSize: number;
    quoteParams: TokenParams;
    quoteLotSize: number;
    tickSizeInQuoteAtomsPerBaseUnit: number;
    rawBaseUnitsPerBaseUnit: number;
    baseLotsPerBaseUnit: number;
    quoteLotsPerBaseUnitPerTick: number;
    priceDecimalPlaces: number;
    takerFeeBps: number;
  }) {
    this.address = address;
    this.marketSizeParams = marketSizeParams;
    this.baseParams = baseParams;
    this.baseLotSize = baseLotSize;
    this.quoteParams = quoteParams;
    this.quoteLotSize = quoteLotSize;
    this.rawBaseUnitsPerBaseUnit = rawBaseUnitsPerBaseUnit;
    this.tickSizeInQuoteAtomsPerBaseUnit = tickSizeInQuoteAtomsPerBaseUnit;
    this.baseLotsPerBaseUnit = baseLotsPerBaseUnit;
    this.quoteLotsPerBaseUnitPerTick = quoteLotsPerBaseUnitPerTick;
    this.priceDecimalPlaces = priceDecimalPlaces;
    this.takerFeeBps = takerFeeBps;
  }

  static fromMarketState(marketState: MarketState): MarketMetadata {
    return new MarketMetadata({
      address: marketState.address,
      marketSizeParams: marketState.data.header.marketSizeParams,
      baseParams: marketState.data.header.baseParams,
      baseLotSize: toNum(marketState.data.header.baseLotSize),
      quoteParams: marketState.data.header.quoteParams,
      quoteLotSize: toNum(marketState.data.header.quoteLotSize),
      tickSizeInQuoteAtomsPerBaseUnit: toNum(
        marketState.data.header.tickSizeInQuoteAtomsPerBaseUnit
      ),
      rawBaseUnitsPerBaseUnit: marketState.data.header.rawBaseUnitsPerBaseUnit,
      baseLotsPerBaseUnit: marketState.data.baseLotsPerBaseUnit,
      quoteLotsPerBaseUnitPerTick: marketState.data.quoteLotsPerBaseUnitPerTick,
      priceDecimalPlaces: marketState.getPriceDecimalPlaces(),
      takerFeeBps: marketState.data.takerFeeBps,
    });
  }

  /**
   * Get a trader's seat account address
   *
   * @param trader The `PublicKey` of the trader account
   */
  public getSeatAddress(trader: PublicKey): PublicKey {
    return getSeatAddress(this.address, trader);
  }

  /**
   * Get a trader's base ATA for a given market
   *
   * @param trader The `PublicKey` of the trader account
   */
  public getBaseAccountKey(trader: PublicKey): PublicKey {
    return getAssociatedTokenAddressSync(this.baseParams.mintKey, trader, true);
  }

  /**
   * Get a trader's quote ATA for a given market
   *
   * @param trader The `PublicKey` of the trader account
   */
  public getQuoteAccountKey(trader: PublicKey): PublicKey {
    return getAssociatedTokenAddressSync(
      this.quoteParams.mintKey,
      trader,
      true
    );
  }

  /**
   * Get the quote vault token account address for a given market
   */
  public getQuoteVaultKey(): PublicKey {
    return this.quoteParams.vaultKey;
  }

  /**
   * Get the base vault token account address for a given market
   */
  public getBaseVaultKey(): PublicKey {
    return this.baseParams.vaultKey;
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
      (price * this.rawBaseUnitsPerBaseUnit * 10 ** this.quoteParams.decimals) /
        (this.quoteLotsPerBaseUnitPerTick * this.quoteLotSize)
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
      (ticks * this.quoteLotsPerBaseUnitPerTick * this.quoteLotSize) /
      (10 ** this.quoteParams.decimals * this.rawBaseUnitsPerBaseUnit)
    );
  }

  /**
   * Given a number of raw base units, returns the equivalent number of base lots (rounded down).
   *
   * @param rawBaseUnits The amount of raw base units to convert
   */
  public rawBaseUnitsToBaseLotsRoundedDown(rawBaseUnits: number): number {
    const baseUnits = rawBaseUnits / this.rawBaseUnitsPerBaseUnit;
    return Math.floor(baseUnits * this.baseLotsPerBaseUnit);
  }

  /**
   * Given a number of raw base units, returns the equivalent number of base lots (rounded up).
   *
   * @param rawBaseUnits The amount of raw base units to convert
   */
  public rawBaseUnitsToBaseLotsRoundedUp(rawBaseUnits: number): number {
    const baseUnits = rawBaseUnits / this.rawBaseUnitsPerBaseUnit;
    return Math.ceil(baseUnits * this.baseLotsPerBaseUnit);
  }

  /**
   * Given a number of base atoms, returns the equivalent number of base lots.
   *
   * @param baseAtoms The amount of base atoms to convert
   */
  public baseAtomsToBaseLots(baseAtoms: number): number {
    return Math.round(baseAtoms / this.baseLotSize);
  }

  /**
   * Given a number of base lots, returns the equivalent number of base atoms.
   *
   * @param baseLots The amount of base lots to convert
   */
  public baseLotsToBaseAtoms(baseLots: number): number {
    return baseLots * this.baseLotSize;
  }

  /**
   * Given a number of base lots, returns the equivalent number of raw base units.
   *
   * @param baseLots The amount of base lots to convert
   */
  public baseLotsToRawBaseUnits(baseLots: number): number {
    return this.baseAtomsToRawBaseUnits(this.baseLotsToBaseAtoms(baseLots));
  }

  /**
   * Given a number of quote units, returns the equivalent number of quote lots.
   *
   * @param quoteUnits The amount of quote units to convert
   */
  public quoteUnitsToQuoteLots(quoteUnits: number): number {
    return Math.round(
      (quoteUnits * 10 ** this.quoteParams.decimals) / this.quoteLotSize
    );
  }

  /**
   * Given a number of quote atoms, returns the equivalent number of quote lots.
   *
   * @param quoteAtoms The amount of quote atoms to convert
   */
  public quoteAtomsToQuoteLots(quoteAtoms: number): number {
    return Math.round(quoteAtoms / this.quoteLotSize);
  }

  /**
   * Given a number of quote lots, returns the equivalent number of quote atoms.
   *
   * @param quoteLots The amount of quote lots to convert
   */
  public quoteLotsToQuoteAtoms(quoteLots: number): number {
    return quoteLots * this.quoteLotSize;
  }

  /**
   * Given a number of quote lots, returns the equivalent number of raw quote units.
   *
   * @param quoteLots The amount of quote lots to convert
   */
  public quoteLotsToQuoteUnits(quoteLots: number): number {
    return this.quoteAtomsToQuoteUnits(this.quoteLotsToQuoteAtoms(quoteLots));
  }

  /**
   * Given a number of base atoms, returns the equivalent number of raw base units.
   *
   * @param baseAtoms The amount of base atoms to convert
   */
  public baseAtomsToRawBaseUnits(baseAtoms: number): number {
    return baseAtoms / 10 ** this.baseParams.decimals;
  }

  /**
   * Given a number of quote atoms, returns the equivalent number of quote units.
   *
   * @param quoteAtoms The amount of quote atoms to convert
   */
  public quoteAtomsToQuoteUnits(quoteAtoms: number): number {
    return quoteAtoms / 10 ** this.quoteParams.decimals;
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
    trader: PublicKey
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
    trader: PublicKey
  ): TransactionInstruction {
    return createDepositFundsInstruction(
      {
        phoenixProgram: PROGRAM_ID,
        logAuthority: getLogAuthority(),
        market: this.address,
        trader,
        seat: this.getSeatAddress(trader),
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
   * @param orderPacket to provide as instruction data to the program
   * @param trader Trader public key
   *
   * @category Instructions
   */
  public createPlaceLimitOrderInstruction(
    orderPacket: OrderPacket,
    trader: PublicKey
  ): TransactionInstruction {
    return createPlaceLimitOrderInstruction(
      {
        phoenixProgram: PROGRAM_ID,
        logAuthority: getLogAuthority(),
        market: this.address,
        trader,
        seat: this.getSeatAddress(trader),
        baseAccount: this.getBaseAccountKey(trader),
        quoteAccount: this.getQuoteAccountKey(trader),
        baseVault: this.getBaseVaultKey(),
        quoteVault: this.getQuoteVaultKey(),
      },
      {
        orderPacket,
      }
    );
  }

  /**
   * Creates a _PlaceLimitOrderWithFreeFunds_ instruction.
   *
   * @param orderPacket to provide as instruction data to the program
   * @param trader Trader public key
   *
   * @category Instructions
   */
  public createPlaceLimitOrderWithFreeFundsInstruction(
    orderPacket: OrderPacket,
    trader: PublicKey
  ) {
    return createPlaceLimitOrderWithFreeFundsInstruction(
      {
        phoenixProgram: PROGRAM_ID,
        logAuthority: getLogAuthority(),
        market: this.address,
        trader,
        seat: this.getSeatAddress(trader),
      },
      { orderPacket }
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
    trader: PublicKey
  ): TransactionInstruction {
    return createPlaceMultiplePostOnlyOrdersInstruction(
      {
        phoenixProgram: PROGRAM_ID,
        logAuthority: getLogAuthority(),
        market: this.address,
        trader,
        seat: this.getSeatAddress(trader),
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
    trader: PublicKey
  ): TransactionInstruction {
    return createPlaceMultiplePostOnlyOrdersWithFreeFundsInstruction(
      {
        phoenixProgram: PROGRAM_ID,
        logAuthority: getLogAuthority(),
        market: this.address,
        trader,
        seat: this.getSeatAddress(trader),
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
      seat: this.getSeatAddress(trader),
    });
  }

  /**
   * Creates a _Swap_ instruction.
   *
   * @param orderPacket to provide as instruction data to the program
   * @param trader Trader public key
   *
   * @category Instructions
   */
  public createSwapInstruction(
    orderPacket: OrderPacket,
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
      { orderPacket }
    );
  }

  /**
   * Creates a _SwapWithFreeFunds_ instruction.
   *
   * @param orderPacket to provide as instruction data to the program
   * @param trader Trader public key
   *
   * @category Instructions
   */
  public createSwapWithFreeFundsInstruction(
    orderPacket: OrderPacket,
    trader: PublicKey
  ) {
    return createSwapWithFreeFundsInstruction(
      {
        phoenixProgram: PROGRAM_ID,
        logAuthority: getLogAuthority(),
        market: this.address,
        trader,
        seat: this.getSeatAddress(trader),
      },
      { orderPacket }
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
    trader: PublicKey
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

  /**
   * Returns an instruction to place a limit order on a market, using a LimitOrderPacketTemplate, which takes in human-friendly units
   * @param trader The trader's address
   * @param limitOrderTemplate The order packet template to place
   * @returns
   */
  public getLimitOrderInstructionfromTemplate(
    trader: PublicKey,
    limitOrderTemplate: LimitOrderTemplate
  ): TransactionInstruction {
    const priceInTicks = this.floatPriceToTicks(
      limitOrderTemplate.priceAsFloat
    );
    const numBaseLots = this.rawBaseUnitsToBaseLotsRoundedDown(
      limitOrderTemplate.sizeInBaseUnits
    );

    const orderPacket = getLimitOrderPacket({
      side: limitOrderTemplate.side,
      priceInTicks,
      numBaseLots,
      selfTradeBehavior: limitOrderTemplate.selfTradeBehavior,
      matchLimit: limitOrderTemplate.matchLimit,
      clientOrderId: limitOrderTemplate.clientOrderId,
      useOnlyDepositedFunds: limitOrderTemplate.useOnlyDepositedFunds,
      lastValidSlot: limitOrderTemplate.lastValidSlot,
      lastValidUnixTimestampInSeconds:
        limitOrderTemplate.lastValidUnixTimestampInSeconds,
    });
    return this.createPlaceLimitOrderInstruction(orderPacket, trader);
  }

  /**
   * Returns an instruction to place a post only on a market, using a PostOnlyOrderPacketTemplate, which takes in human-friendly units.
   * @param trader The trader's address
   * @param postOnlyOrderTemplate The order packet template to place
   * @returns
   */
  public getPostOnlyOrderInstructionfromTemplate(
    trader: PublicKey,
    postOnlyOrderTemplate: PostOnlyOrderTemplate
  ): TransactionInstruction {
    const priceInTicks = this.floatPriceToTicks(
      postOnlyOrderTemplate.priceAsFloat
    );
    const numBaseLots = this.rawBaseUnitsToBaseLotsRoundedDown(
      postOnlyOrderTemplate.sizeInBaseUnits
    );

    const orderPacket = getPostOnlyOrderPacket({
      side: postOnlyOrderTemplate.side,
      priceInTicks,
      numBaseLots,
      clientOrderId: postOnlyOrderTemplate.clientOrderId,
      rejectPostOnly: postOnlyOrderTemplate.rejectPostOnly,
      useOnlyDepositedFunds: postOnlyOrderTemplate.useOnlyDepositedFunds,
      lastValidSlot: postOnlyOrderTemplate.lastValidSlot,
      lastValidUnixTimestampInSeconds:
        postOnlyOrderTemplate.lastValidUnixTimestampInSeconds,
    });
    return this.createPlaceLimitOrderInstruction(orderPacket, trader);
  }

  /**
   * Returns an instruction to place an immediate or cancel on a market, using a ImmediateOrCancelPacketTemplate, which takes in human-friendly units.
   * @param trader The trader's address
   * @param immediateOrCancelOrderTemplate The order packet template to place
   * @returns
   */
  public getImmediateOrCancelOrderInstructionfromTemplate(
    trader: PublicKey,
    immediateOrCancelOrderTemplate: ImmediateOrCancelOrderTemplate
  ): TransactionInstruction {
    const priceInTicks = this.floatPriceToTicks(
      immediateOrCancelOrderTemplate.priceAsFloat
    );
    const numBaseLots = this.rawBaseUnitsToBaseLotsRoundedDown(
      immediateOrCancelOrderTemplate.sizeInBaseUnits
    );
    const numQuoteLots = this.quoteUnitsToQuoteLots(
      immediateOrCancelOrderTemplate.sizeInQuoteUnits
    );
    const minBaseLotsToFill = this.rawBaseUnitsToBaseLotsRoundedDown(
      immediateOrCancelOrderTemplate.minBaseUnitsToFill
    );
    const minQuoteLotsToFill = this.quoteUnitsToQuoteLots(
      immediateOrCancelOrderTemplate.minQuoteUnitsToFill
    );

    const orderPacket = getImmediateOrCancelOrderPacket({
      side: immediateOrCancelOrderTemplate.side,
      priceInTicks,
      numBaseLots,
      numQuoteLots,
      minBaseLotsToFill,
      minQuoteLotsToFill,
      selfTradeBehavior: immediateOrCancelOrderTemplate.selfTradeBehavior,
      matchLimit: immediateOrCancelOrderTemplate.matchLimit,
      clientOrderId: immediateOrCancelOrderTemplate.clientOrderId,
      useOnlyDepositedFunds:
        immediateOrCancelOrderTemplate.useOnlyDepositedFunds,
      lastValidSlot: immediateOrCancelOrderTemplate.lastValidSlot,
      lastValidUnixTimestampInSeconds:
        immediateOrCancelOrderTemplate.lastValidUnixTimestampInSeconds,
    });
    return this.createSwapInstruction(orderPacket, trader);
  }
}
