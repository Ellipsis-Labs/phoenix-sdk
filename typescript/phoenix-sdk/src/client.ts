import { Connection, PublicKey } from "@solana/web3.js";

import CONFIG from "../config.json";
import { getClusterFromEndpoint } from "./utils";
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
   * @param trader The `PublicKey` of the trader account to use for the client (optional)
   */
  static async create(
    connection: Connection,
    trader?: PublicKey
  ): Promise<Client> {
    const cluster = getClusterFromEndpoint(connection.rpcEndpoint);

    const markets = [];
    const tokens = [];

    await Promise.all(
      // For every market:
      CONFIG[cluster].markets.map(async (marketAddress: string) => {
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
}
