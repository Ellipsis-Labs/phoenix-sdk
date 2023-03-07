import * as splToken from "@solana/spl-token";
import * as beet from "@metaplex-foundation/beet";
import * as web3 from "@solana/web3.js";
import { BN } from "bn.js";
import { Client, MarketData } from "../../src";

// Helper types and functions for interacting with the generic token faucet; only used for devnet testing.
export const airdropSplInstructionDiscriminator = Buffer.from(
  Uint8Array.from([133, 44, 125, 96, 172, 219, 228, 51])
);

export type AirdropSplInstructionAccounts = {
  mint: web3.PublicKey;
  mintAuthority: web3.PublicKey;
  destination: web3.PublicKey;
  tokenProgram?: web3.PublicKey;
};

export type AirdropSplInstructionArgs = { amount: beet.bignum };

export function createAirdropSplInstruction(
  accounts: AirdropSplInstructionAccounts,
  amount: number,
  programId = new web3.PublicKey("FF2UnZt7Lce3S65tW5cMVKz8iVAPoCS8ETavmUhsWLJB")
) {
  const numberBuffer = new BN(amount).toBuffer("le", 8);

  const data = Buffer.concat([
    airdropSplInstructionDiscriminator,
    numberBuffer,
  ]);

  const keys: web3.AccountMeta[] = [
    { pubkey: accounts.mint, isSigner: false, isWritable: true },
    { pubkey: accounts.mintAuthority, isSigner: false, isWritable: false },
    { pubkey: accounts.destination, isSigner: false, isWritable: true },
    {
      pubkey: accounts.tokenProgram ?? splToken.TOKEN_PROGRAM_ID,
      isSigner: false,
      isWritable: false,
    },
  ];
  return new web3.TransactionInstruction({ keys, programId, data });
}

export function getAirdropSplInstruction(
  mint: web3.PublicKey,
  mintAuthority: web3.PublicKey,
  destination: web3.PublicKey,
  amount: number
): web3.TransactionInstruction {
  const tokenAccount = splToken.getAssociatedTokenAddressSync(
    mint,
    destination
  );

  const accounts: AirdropSplInstructionAccounts = {
    mint,
    mintAuthority,
    destination: tokenAccount,
  };

  return createAirdropSplInstruction(accounts, amount);
}

// For devnet testing, we use a dummy devnet market whose base and quote tokens are mintable through these instructions.
// This function takes in a market's data and a trader pubkey and airdrops both tokens for that market to the trader.
export async function airdropSplTokensForMarketIxs(
  phoenixClient: Client,
  marketData: MarketData,
  traderPubkey: web3.PublicKey
): Promise<web3.TransactionInstruction[]> {
  const baseMint = marketData.header.baseParams.mintKey;
  const quoteMint = marketData.header.quoteParams.mintKey;

  const [baseMintData, quoteMintData] = await Promise.all([
    splToken.getMint(phoenixClient.connection, baseMint),
    splToken.getMint(phoenixClient.connection, quoteMint),
  ]);

  if (baseMintData.mintAuthority === null) {
    throw Error("Mint authority not found");
  }

  if (quoteMintData.mintAuthority === null) {
    throw Error("Mint authority not found");
  }

  const airdropBaseTokenIx = getAirdropSplInstruction(
    marketData.header.baseParams.mintKey,
    baseMintData.mintAuthority,
    traderPubkey,
    1_000_000_000
  );
  const airdropQuoteTokenIx = getAirdropSplInstruction(
    marketData.header.quoteParams.mintKey,
    quoteMintData.mintAuthority,
    traderPubkey,
    1_000_000_000
  );

  return [airdropBaseTokenIx, airdropQuoteTokenIx];
}
