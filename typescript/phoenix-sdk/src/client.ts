import { Connection, PublicKey } from "@solana/web3.js";

import CONFIG from "../config.json";
import { Token } from "./token";
import { Market } from "./market";

export class Client {
  connection: Connection;
  trader?: PublicKey;
  tokens: Array<Token>;
  markets: Array<Market>;

  private constructor({
    connection,
    trader,
    tokens,
    markets,
  }: {
    connection: Connection;
    trader?: PublicKey;
    tokens: Array<Token>;
    markets: Array<Market>;
  }) {
    this.connection = connection;
    this.trader = trader;
    this.tokens = tokens;
    this.markets = markets;
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

      // Set the tokens from the market
      for (const token of [market.baseToken, market.quoteToken]) {
        const mint = token.data.mintKey.toBase58();
        if (tokens.find((t) => t.data.mintKey.toBase58() === mint)) continue;
        tokens.push(token);

        // If client provided a trader, get their balance of the token
        if (trader) {
          await token.setTokenBalanceAndSubcribe(connection, trader);
        }
      }
    }

    return new Client({
      connection,
      trader,
      tokens,
      markets,
    });
  }
}
