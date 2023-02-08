import { TOKEN_PROGRAM_ID, AccountLayout } from "@solana/spl-token";
import { Connection, PublicKey, TokenAmount } from "@solana/web3.js";

import { Token } from "./token";

export class Trader {
  pubkey: PublicKey;
  tokenBalances: Record<string, TokenAmount>;

  private constructor(publicKey: PublicKey) {
    this.pubkey = publicKey;
    this.tokenBalances = {};
  }

  /**
   * Returns a `Trader` object for a given trader address and subscribes to updates
   *
   * @param connection The Solana `Connection` object
   * @param pubkey The `PublicKey` of the trader
   * @param tokens The list of `Token` objects to load balances for
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
    const trader = new Trader(pubkey);

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
        getTokenAmountFromBuffer(
          tokenAccount.account.data,
          token.data.decimals
        );
    }

    return trader;
  }

  /**
   * Refreshes the trader data
   *
   * @param connection The Solana `Connection` object
   *
   * @returns The refreshed Trader
   */
  async refresh(connection: Connection): Promise<Trader> {
    // Refresh token balances
    await Promise.all(
      Object.keys(this.tokenBalances).map(async (mintKey) => {
        const tokenAccounts = await connection.getTokenAccountsByOwner(
          this.pubkey,
          {
            programId: TOKEN_PROGRAM_ID,
            mint: new PublicKey(mintKey),
          }
        );

        const tokenAccount = tokenAccounts.value[0];
        this.tokenBalances[mintKey] = getTokenAmountFromBuffer(
          tokenAccount.account.data,
          this.tokenBalances[mintKey].decimals
        );
      })
    );

    return this;
  }
}

/**
 * Returns a `TokenAmount` object from a token account data buffer
 *
 * @param data The token account data buffer
 * @param decimals The number of decimals for the token
 */
function getTokenAmountFromBuffer(data: Buffer, decimals: number): TokenAmount {
  const tokenAccountRaw = AccountLayout.decode(data);
  const amount = tokenAccountRaw.amount.toString();

  return {
    amount,
    decimals,
    uiAmount: parseInt(amount) / 10 ** decimals,
  };
}
