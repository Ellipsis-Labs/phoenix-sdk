import { Connection, PublicKey } from "@solana/web3.js";

import CONFIG from "../config.json";
import { Token } from "./token";
import { Market } from "./market";
import { Trader } from "./trader";

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
   * @param wallet The `WalletAdapter` to use for submitting transactions (optional)
   */
  static async create(
    connection: Connection,
    trader?: PublicKey
  ): Promise<Client> {
    const cluster = connection.rpcEndpoint.includes("devnet")
      ? "devnet"
      : "mainnet-beta";

    const markets = [];
    const tokens = [];

    // For every market:
    for (const marketAddress of CONFIG[cluster].markets) {
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
    }

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
   * Subscribes to all market and trader changes
   */
  subscribe() {
    for (const market of this.markets) {
      market.subscribe(this.connection);
    }

    if (this.trader) {
      this.trader.subscribe(this.connection);
    }
  }

  /**
   * Unsubscribes from all subscriptions when the client is no longer needed
   */
  async unsubscribe() {
    for (const market of this.markets) {
      market.unsubscribe(this.connection);
    }

    if (this.trader) {
      this.trader.unsubscribe(this.connection);
    }
  }
}
