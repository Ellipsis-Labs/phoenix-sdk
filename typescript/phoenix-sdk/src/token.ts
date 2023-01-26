import { AccountLayout, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, PublicKey, TokenAmount } from "@solana/web3.js";

import { TokenParams } from "./types";

export class Token {
  name: string;
  symbol: string;
  logoUri: string;
  balance: TokenAmount | null;
  data: TokenParams;

  constructor({
    name,
    symbol,
    logoUri,
    data,
  }: {
    name: string;
    symbol: string;
    logoUri: string;
    data: TokenParams;
  }) {
    this.name = name;
    this.symbol = symbol;
    this.logoUri = logoUri;
    this.balance = null;
    this.data = data;
  }

  /**
   * Sets the current token balanc for an owner and subscribes to balance updates
   *
   * @param connection The Solana `Connection` to use for the client
   * @param owner The `PublicKey` of the owner to get the balance for
   */
  async setTokenBalanceAndSubcribe(
    connection: Connection,
    owner: PublicKey
  ): Promise<void> {
    const tokenAccounts = await connection.getTokenAccountsByOwner(owner, {
      programId: TOKEN_PROGRAM_ID,
      mint: this.data.mintKey,
    });
    if (tokenAccounts.value.length === 0)
      throw new Error(
        "No token accounts found for this token for owner: " + owner.toBase58()
      );

    // Set current balance
    const tokenAccount = tokenAccounts.value[0];
    const tokenAccountData = AccountLayout.decode(
      tokenAccounts.value[0].account.data
    );
    this.balance = {
      amount: tokenAccountData.amount.toString(),
      decimals: this.data.decimals,
      uiAmount:
        parseInt(tokenAccountData.amount.toString()) / 10 ** this.data.decimals,
    };

    // Subscribe to balance updates
    connection.onAccountChange(tokenAccount.pubkey, (accountInfo) => {
      const tokenAccountData = AccountLayout.decode(accountInfo.data);
      const balance: TokenAmount = {
        amount: tokenAccountData.amount.toString(),
        decimals: this.data.decimals,
        uiAmount:
          parseInt(tokenAccountData.amount.toString()) /
          10 ** this.data.decimals,
      };

      this.balance = balance;
    });
  }
}
