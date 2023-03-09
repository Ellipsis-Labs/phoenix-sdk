import { Connection, PublicKey } from "@solana/web3.js";

import { getClusterFromEndpoint, toNum } from "./utils";
import { Token } from "./token";
import { Market } from "./market";
import { Trader } from "./trader";
import { StringTypeMap } from "@metaplex-foundation/beet";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PROGRAM_ID } from "./index";
import axios from "axios";

export class Client {
  connection: Connection;
  trader: Trader;
  tokens: Array<Token>;
  markets: Array<Market>;

  private constructor({
    connection,
    tokens,
    markets,
    trader,
  }: {
    connection: Connection;
    tokens: Array<Token>;
    markets: Array<Market>;
    trader?: Trader;
  }) {
    this.connection = connection;
    this.tokens = tokens;
    this.markets = markets;
    this.trader = trader;
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
    let config_url =
      "https://raw.githubusercontent.com/Ellipsis-Labs/phoenix-sdk/master/typescript/phoenix-sdk/config.json";

    const config = await axios.get(config_url).then((response) => {
      return response.data;
    });
    const markets = [];
    const tokens = [];

    await Promise.all(
      // For every market:
      config[cluster].markets.map(async (marketAddress: string) => {
        // Load the market
        const market = await Market.load({
          connection,
          address: new PublicKey(marketAddress),
        });
        markets.push(market);

        // Set the tokens from the market (avoiding duplicates)
        for (const token of [market.baseToken, market.quoteToken]) {
          const mint = token.data.mintKey.toBase58();
          if (tokens.find((t) => t.data.mintKey.toBase58() === mint)) continue;
          tokens.push(token);
        }
      })
    );

    return new Client({
      connection,
      tokens,
      markets,
      trader: trader
        ? await Trader.create({
            connection,
            pubkey: trader,
            tokens,
          })
        : undefined,
    });
  }

  /**
   * Add a market to the client. Useful for localnet as markets will not be loaded in by default.
   * @param marketAddress The `PublicKey` of the market account
   *
   */
  public async addMarket(marketAddress: String) {
    const market = await Market.load({
      connection: this.connection,
      address: new PublicKey(marketAddress),
    });
    this.markets.push(market);
    for (const token of [market.baseToken, market.quoteToken]) {
      const mint = token.data.mintKey.toBase58();
      if (this.tokens.find((t) => t.data.mintKey.toBase58() === mint)) continue;
      this.tokens.push(token);
    }
  }

  /**
   * Get the Pubkey for a trader's Base Token Account on Phoenix
   * @param trader The `PublicKey` of the trader account
   * @param marketAddress The `PublicKey` of the market account
  */
  public getBaseAccountKey(
    trader: PublicKey,
    marketAddress: String
  ): PublicKey {
    let market = this.markets.find(
      (m) => m.address.toBase58() === marketAddress
    );
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
   * Get the Pubkey for a trader's Quote Token Account on Phoenix
   * @param trader The `PublicKey` of the trader account
   * @param marketAddress The `PublicKey` of the market account
  */
  public getQuoteAccountKey(
    trader: PublicKey,
    marketAddress: String
  ): PublicKey {
    let market = this.markets.find(
      (m) => m.address.toBase58() === marketAddress
    );
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
   * Get the Pubkey for a trader's Seat Account 
   * @param trader The `PublicKey` of the trader account
   * @param marketAddress The `PublicKey` of the market account
  */
  public getSeatKey(trader: PublicKey, marketAddress: String): PublicKey {
    let market = this.markets.find(
      (m) => m.address.toBase58() === marketAddress
    );
    if (!market) throw new Error("Market not found: " + marketAddress);
    let market_pubkey = new PublicKey(
      "14CAwu3LiBBk5fcHGdTsFyVxDwvpgFiSfDwgPJxECcE5"
    );
    return PublicKey.findProgramAddressSync(
      [Buffer.from("seat"), market_pubkey.toBuffer(), trader.toBuffer()],
      PROGRAM_ID
    )[0];
  }

  /**
   * Get the Log Authority Pubkey 
  */
  public getLogAuthority(): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("log")],
      PROGRAM_ID
    )[0];
  }

  /**
   * Get the price in ticks for a given price 
   * @param price The price to convert
   * @param marketAddress The `PublicKey` of the market account
  */
  public floatPriceToTicks(price: number, marketAddress: String): number {
    let market = this.markets.find(
      (m) => m.address.toBase58() === marketAddress
    );
    if (!market) throw new Error("Market not found: " + marketAddress);
    return Math.round(
      (price * 10 ** market.quoteToken.data.decimals) /
        market.data.quoteLotsPerBaseUnitPerTick
    );
  }

  /**
   * Get the price in quote units for a given price in ticks
   * @param ticks  The price in ticks to convert
   * @param marketAddress  The `PublicKey` of the market account
   */
  public ticksToFloatPrice(ticks: number, marketAddress: String): number {
    let market = this.markets.find(
      (m) => m.address.toBase58() === marketAddress
    );
    if (!market) throw new Error("Market not found: " + marketAddress);
    return (
      (ticks * market.data.quoteLotsPerBaseUnitPerTick) /
      10 ** market.quoteToken.data.decimals
    );
  }

  /**
   * Get the amount of base lots for a given amount of raw base units (rounded down)
   * @param rawBaseUnits The amount of raw base units to convert
   * @param marketAddress The `PublicKey` of the market account
   */
  public rawBaseUnitsToBaseLots(
    rawBaseUnits: number,
    marketAddress: String
  ): number {
    let market = this.markets.find(
      (m) => m.address.toBase58() === marketAddress
    );
    if (!market) throw new Error("Market not found: " + marketAddress);
    let base_units = rawBaseUnits / market.data.header.rawBaseUnitsPerBaseUnit;
    return Math.floor(base_units * market.data.baseLotsPerBaseUnit);
  }

  /**
   * Get the amount of base lots for a given amount of raw base units (rounded up)
   * @param rawBaseUnits The amount of raw base units to convert
   * @param marketAddress The `PublicKey` of the market account
  */
  public rawBaseUnitsToBaseLotsRoundedUp(
    rawBaseUnits: number,
    marketAddress: String
  ): number {
    let market = this.markets.find(
      (m) => m.address.toBase58() === marketAddress
    );
    if (!market) throw new Error("Market not found: " + marketAddress);
    let base_units = rawBaseUnits / market.data.header.rawBaseUnitsPerBaseUnit;
    return Math.ceil(base_units * market.data.baseLotsPerBaseUnit);
  }

  /**
   * Get the amount of base lots for a given amount base atoms
   * @param baseAtoms The amount of base atoms to convert
   * @param marketAddress The `PublicKey` of the market account
  */
  public baseAtomsToBaseLots(baseAtoms: number, marketAddress: String): number {
    let market = this.markets.find(
      (m) => m.address.toBase58() === marketAddress
    );
    if (!market) throw new Error("Market not found: " + marketAddress);
    return Math.round(baseAtoms / toNum(market.data.header.baseLotSize));
  }

  /**
   * Get the amount of base atoms for a given amount of base lots
   * @param baseLots The amount of base lots to convert
   * @param marketAddress The `PublicKey` of the market account
  */
  public baseLotsToBaseAtoms(baseLots: number, marketAddress: String): number {
    let market = this.markets.find(
      (m) => m.address.toBase58() === marketAddress
    );
    if (!market) throw new Error("Market not found: " + marketAddress);
    return baseLots * toNum(market.data.header.baseLotSize);
  }

  /**
   * Get the amount of quote lots for a given amount of quote units
   * @param quoteUnits The amount of quote units to convert
   * @param marketAddress The `PublicKey` of the market account
  */
  public quoteUnitsToQuoteLots(
    quoteUnits: number,
    marketAddress: String
  ): number {
    let market = this.markets.find(
      (m) => m.address.toBase58() === marketAddress
    );
    if (!market) throw new Error("Market not found: " + marketAddress);
    return Math.round(
      (quoteUnits * 10 ** market.quoteToken.data.decimals) /
        toNum(market.data.header.quoteLotSize)
    );
  }

  /**
   * Get the amount of quote lots for a given amount of quote atoms
   * @param quoteAtoms The amount of quote atoms to convert
   * @param marketAddress The `PublicKey` of the market account
  */
  public quoteAtomsToQuoteLots(
    quoteAtoms: number,
    marketAddress: String
  ): number {
    let market = this.markets.find(
      (m) => m.address.toBase58() === marketAddress
    );
    if (!market) throw new Error("Market not found: " + marketAddress);
    return Math.round(quoteAtoms / toNum(market.data.header.quoteLotSize));
  }

  /**
   * Get the amount of quote atoms for a given amount of quote lots
   * @param quoteLots The amount of quote lots to convert
   * @param marketAddress The `PublicKey` of the market account
  */
  public quoteLotsToQuoteAtoms(
    quoteLots: number,
    marketAddress: String
  ): number {
    let market = this.markets.find(
      (m) => m.address.toBase58() === marketAddress
    );
    if (!market) throw new Error("Market not found: " + marketAddress);
    return quoteLots * toNum(market.data.header.quoteLotSize);
  }

  /**
   * Get the amount of base units for a given amount of base atoms
   * @param baseAtoms The amount of base atoms to convert
   * @param marketAddress The `PublicKey` of the market account
  */
  public baseAtomsToBaseUnits(
    baseAtoms: number,
    marketAddress: String
  ): number {
    let market = this.markets.find(
      (m) => m.address.toBase58() === marketAddress
    );
    if (!market) throw new Error("Market not found: " + marketAddress);
    return baseAtoms / 10 ** market.baseToken.data.decimals;
  }

  /**
   * Get the amount of quote units for a given amount of quote atoms
   * @param quoteAtoms The amount of quote atoms to convert
   * @param marketAddress The `PublicKey` of the market account
  */
  public quoteAtomsToQuoteUnits(
    quoteAtoms: number,
    marketAddress: String
  ): number {
    let market = this.markets.find(
      (m) => m.address.toBase58() === marketAddress
    );
    if (!market) throw new Error("Market not found: " + marketAddress);
    return quoteAtoms / 10 ** market.quoteToken.data.decimals;
  }

  /**
   * Get the amount of quote atoms for an order with a given amount of base lots and a price in ticks
   * @param baseLots The amount of base lots to convert
   * @param price_in_ticks The price in ticks
   * @param marketAddress The `PublicKey` of the market account
  */
  public orderToQuoteAmount(
    baseLots: number,
    price_in_ticks: number,
    marketAddress: String
  ): number {
    let market = this.markets.find(
      (m) => m.address.toBase58() === marketAddress
    );
    if (!market) throw new Error("Market not found: " + marketAddress);
    return Math.round(
      (baseLots *
        price_in_ticks *
        toNum(market.data.header.tickSizeInQuoteAtomsPerBaseUnit)) /
        market.data.baseLotsPerBaseUnit
    );
  }
}
