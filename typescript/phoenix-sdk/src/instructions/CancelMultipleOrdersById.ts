/**
 * This code was GENERATED using the solita package.
 * Please DO NOT EDIT THIS FILE, instead rerun solita to update it or write a wrapper to add functionality.
 *
 * See: https://github.com/metaplex-foundation/solita
 */

import * as splToken from "@solana/spl-token";
import * as beet from "@metaplex-foundation/beet";
import * as web3 from "@solana/web3.js";
import {
  CancelMultipleOrdersByIdParams,
  cancelMultipleOrdersByIdParamsBeet,
} from "../types/CancelMultipleOrdersByIdParams";
import { Client } from "client";

/**
 * @category Instructions
 * @category CancelMultipleOrdersById
 * @category generated
 */
export type CancelMultipleOrdersByIdInstructionArgs = {
  params: CancelMultipleOrdersByIdParams;
};
/**
 * @category Instructions
 * @category CancelMultipleOrdersById
 * @category generated
 */
export const CancelMultipleOrdersByIdStruct = new beet.FixableBeetArgsStruct<
  CancelMultipleOrdersByIdInstructionArgs & {
    instructionDiscriminator: number;
  }
>(
  [
    ["instructionDiscriminator", beet.u8],
    ["params", cancelMultipleOrdersByIdParamsBeet],
  ],
  "CancelMultipleOrdersByIdInstructionArgs"
);
/**
 * Accounts required by the _CancelMultipleOrdersById_ instruction
 *
 * @property [] phoenixProgram Phoenix program
 * @property [] logAuthority Phoenix log authority
 * @property [_writable_] market This account holds the market state
 * @property [**signer**] trader
 * @property [_writable_] baseAccount Trader base token account
 * @property [_writable_] quoteAccount Trader quote token account
 * @property [_writable_] baseVault Base vault PDA, seeds are [b'vault', market_address, base_mint_address]
 * @property [_writable_] quoteVault Quote vault PDA, seeds are [b'vault', market_address, quote_mint_address]
 * @category Instructions
 * @category CancelMultipleOrdersById
 * @category generated
 */
export type CancelMultipleOrdersByIdInstructionAccounts = {
  phoenixProgram: web3.PublicKey;
  logAuthority: web3.PublicKey;
  market: web3.PublicKey;
  trader: web3.PublicKey;
  baseAccount: web3.PublicKey;
  quoteAccount: web3.PublicKey;
  baseVault: web3.PublicKey;
  quoteVault: web3.PublicKey;
  tokenProgram?: web3.PublicKey;
};

export const cancelMultipleOrdersByIdInstructionDiscriminator = 10;

/**
 * Creates a _CancelMultipleOrdersById_ instruction.
 *
 * @param accounts that will be accessed while the instruction is processed
 * @param args to provide as instruction data to the program
 *
 * @category Instructions
 * @category CancelMultipleOrdersById
 * @category generated
 */
export function createCancelMultipleOrdersByIdInstruction(
  accounts: CancelMultipleOrdersByIdInstructionAccounts,
  args: CancelMultipleOrdersByIdInstructionArgs,
  programId = new web3.PublicKey("PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY")
) {
  const [data] = CancelMultipleOrdersByIdStruct.serialize({
    instructionDiscriminator: cancelMultipleOrdersByIdInstructionDiscriminator,
    ...args,
  });
  const keys: web3.AccountMeta[] = [
    {
      pubkey: accounts.phoenixProgram,
      isWritable: false,
      isSigner: false,
    },
    {
      pubkey: accounts.logAuthority,
      isWritable: false,
      isSigner: false,
    },
    {
      pubkey: accounts.market,
      isWritable: true,
      isSigner: false,
    },
    {
      pubkey: accounts.trader,
      isWritable: false,
      isSigner: true,
    },
    {
      pubkey: accounts.baseAccount,
      isWritable: true,
      isSigner: false,
    },
    {
      pubkey: accounts.quoteAccount,
      isWritable: true,
      isSigner: false,
    },
    {
      pubkey: accounts.baseVault,
      isWritable: true,
      isSigner: false,
    },
    {
      pubkey: accounts.quoteVault,
      isWritable: true,
      isSigner: false,
    },
    {
      pubkey: accounts.tokenProgram ?? splToken.TOKEN_PROGRAM_ID,
      isWritable: false,
      isSigner: false,
    },
  ];

  const ix = new web3.TransactionInstruction({
    programId,
    keys,
    data,
  });
  return ix;
}

/**
 * Creates a _CancelMultipleOrdersById_ instruction.
 *
 * @param client Phoenix SDK client to use
 * @param args to provide as instruction data to the program
 * @param marketAddress Market address string
 * @param trader Trader public key
 *
 * @category Instructions
 * @category CancelMultipleOrdersById
 * @category generated
 */
export function createCancelMultipleOrdersByIdInstructionWithClient(
  client: Client,
  args: CancelMultipleOrdersByIdInstructionArgs,
  marketAddress: String,
  trader: web3.PublicKey,
  tokenProgram?: web3.PublicKey,
  programId = new web3.PublicKey("PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY")
): web3.TransactionInstruction {
  const [data] = CancelMultipleOrdersByIdStruct.serialize({
    instructionDiscriminator: cancelMultipleOrdersByIdInstructionDiscriminator,
    ...args,
  });

  let market = client.markets.find(
    (m) => m.address.toBase58() === marketAddress
  );
  if (!market) throw new Error("Market not found: " + marketAddress);

  const keys: web3.AccountMeta[] = [
    {
      pubkey: programId,
      isWritable: false,
      isSigner: false,
    },
    {
      pubkey: client.getLogAuthority(),
      isWritable: false,
      isSigner: false,
    },
    {
      pubkey: new web3.PublicKey(marketAddress),
      isWritable: true,
      isSigner: false,
    },
    {
      pubkey: trader,
      isWritable: false,
      isSigner: true,
    },
    {
      pubkey: client.getBaseAccountKey(trader, marketAddress),
      isWritable: true,
      isSigner: false,
    },
    {
      pubkey: client.getQuoteAccountKey(trader, marketAddress),
      isWritable: true,
      isSigner: false,
    },
    {
      pubkey: market.data.header.baseParams.vaultKey,
      isWritable: true,
      isSigner: false,
    },
    {
      pubkey: market.data.header.quoteParams.vaultKey,
      isWritable: true,
      isSigner: false,
    },
    {
      pubkey: tokenProgram ?? splToken.TOKEN_PROGRAM_ID,
      isWritable: false,
      isSigner: false,
    },
  ];

  const ix = new web3.TransactionInstruction({
    programId,
    keys,
    data,
  });
  return ix;
}
