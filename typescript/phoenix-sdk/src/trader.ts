import { TOKEN_PROGRAM_ID, AccountLayout } from "@solana/spl-token";
import { Connection, PublicKey, TokenAmount } from "@solana/web3.js";

import { Token } from "./token";

// TODO would be nice to add other stuff like orders, history, etc.
export class Trader {
  private connection: Connection;
  pubkey: PublicKey;
  tokenBalances: Record<string, TokenAmount>;

  private constructor({
    connection,
    pubkey,
    tokenBalances,
  }: {
    connection: Connection;
    pubkey: PublicKey;
    tokenBalances: Record<string, TokenAmount>;
  }) {
    this.connection = connection;
    this.pubkey = pubkey;
    this.tokenBalances = tokenBalances;
  }

  /**
   * Returns a `Trader` object for a given trader address and subscribes to updates
   *
   * @param connection The Solana `Connection` object
   * @param pubkey The `PublicKey` of the trader
   */
  static async create({
    connection,
    pubkey,
    tokens,
  }: {
    connection: Connection;
    pubkey: PublicKey;
    tokens: Array<Token>;
  }): Promise<Trader> {
    const trader = new Trader({
      connection,
      pubkey,
      tokenBalances: {},
    });

    // Token balances
    for (const token of tokens) {
      const tokenAccounts = await connection.getTokenAccountsByOwner(pubkey, {
        programId: TOKEN_PROGRAM_ID,
        mint: token.data.mintKey,
      });
      if (tokenAccounts.value.length === 0) continue;

      // Set current token balance
      const tokenAccount = tokenAccounts.value[0];
      trader.tokenBalances[token.data.mintKey.toBase58()] =
        getTokenAmountFromRawAccount(
          tokenAccount.account.data,
          token.data.decimals
        );

      // Subscribe to token balance updates
      connection.onAccountChange(tokenAccount.pubkey, (accountInfo) => {
        trader.tokenBalances[token.data.mintKey.toBase58()] =
          getTokenAmountFromRawAccount(accountInfo.data, token.data.decimals);
      });
    }

    return trader;
  }

  /**
   * Refreshes the trader data
   */
  async refresh() {
    // Refresh token balances
    for (const tokenMint in this.tokenBalances) {
      const mint = new PublicKey(tokenMint);
      const tokenAccounts = await this.connection.getTokenAccountsByOwner(
        mint,
        {
          programId: TOKEN_PROGRAM_ID,
          mint,
        }
      );

      const tokenAccount = tokenAccounts.value[0];
      this.tokenBalances[tokenMint] = getTokenAmountFromRawAccount(
        tokenAccount.account.data,
        this.tokenBalances[tokenMint].decimals
      );
    }
  }
}

/**
 * Returns a `TokenAmount` object from a token account data buffer
 *
 * @param data The token account data buffer
 * @param decimals The number of decimals for the token
 */
function getTokenAmountFromRawAccount(
  data: Buffer,
  decimals: number
): TokenAmount {
  const tokenAccountRaw = AccountLayout.decode(data);
  const amount = tokenAccountRaw.amount.toString();
  return {
    amount,
    decimals,
    uiAmount: parseInt(amount) / 10 ** decimals,
  };
}
