import { TOKEN_PROGRAM_ID, AccountLayout } from "@solana/spl-token";
import { Connection, PublicKey, TokenAmount } from "@solana/web3.js";

import { Token } from "./token";

// TODO would be nice to add other stuff like orders, history, etc.
export class Trader {
  pubkey: PublicKey;
  tokenBalances: Record<string, TokenAmount>;
  private subscriptions: Array<number>;

  private constructor(publicKey: PublicKey) {
    this.pubkey = publicKey;
    this.tokenBalances = {};
    this.subscriptions = [];
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
   */
  async refresh(connection: Connection) {
    // Refresh token balances
    for (const mintKey in this.tokenBalances) {
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
    }
  }

  /**
   * Subscribes to trader updates
   *
   * @param connection The Solana `Connection` object
   */
  async subscribe(connection: Connection) {
    // Subscribe to token balance updates
    for (const mintKey in this.tokenBalances) {
      const tokenAccounts = await connection.getTokenAccountsByOwner(
        this.pubkey,
        {
          programId: TOKEN_PROGRAM_ID,
          mint: new PublicKey(mintKey),
        }
      );

      const tokenAccount = tokenAccounts.value[0];
      const subId = connection.onAccountChange(
        tokenAccount.pubkey,
        (accountInfo) => {
          this.tokenBalances[mintKey] = getTokenAmountFromBuffer(
            accountInfo.data,
            this.tokenBalances[mintKey].decimals
          );
        }
      );
      this.subscriptions.push(subId);
    }
  }

  /**
   * Unsubscribes from updates when the trader is no longer needed
   *
   * @param connection The Solana `Connection` object
   */
  unsubscribe(connection: Connection) {
    for (const subId of this.subscriptions) {
      connection.removeAccountChangeListener(subId);
    }

    this.subscriptions = [];
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
