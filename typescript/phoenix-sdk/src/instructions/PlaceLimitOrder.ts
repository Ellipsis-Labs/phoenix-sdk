/**
 * This code was GENERATED using the solita package.
 * Please DO NOT EDIT THIS FILE, instead rerun solita to update it or write a wrapper to add functionality.
 *
 * See: https://github.com/metaplex-foundation/solita
 */

import * as splToken from "@solana/spl-token";
import * as beet from "@metaplex-foundation/beet";
import * as web3 from "@solana/web3.js";
import { OrderPacket, orderPacketBeet } from "../types/OrderPacket";
import { Client } from "client";

/**
 * @category Instructions
 * @category PlaceLimitOrder
 * @category generated
 */
export type PlaceLimitOrderInstructionArgs = {
  orderPacket: OrderPacket;
};
/**
 * @category Instructions
 * @category PlaceLimitOrder
 * @category generated
 */
export const PlaceLimitOrderStruct = new beet.FixableBeetArgsStruct<
  PlaceLimitOrderInstructionArgs & {
    instructionDiscriminator: number;
  }
>(
  [
    ["instructionDiscriminator", beet.u8],
    ["orderPacket", orderPacketBeet],
  ],
  "PlaceLimitOrderInstructionArgs"
);
/**
 * Accounts required by the _PlaceLimitOrder_ instruction
 *
 * @property [] phoenixProgram Phoenix program
 * @property [] logAuthority Phoenix log authority
 * @property [_writable_] market This account holds the market state
 * @property [**signer**] trader
 * @property [] seat
 * @property [_writable_] baseAccount Trader base token account
 * @property [_writable_] quoteAccount Trader quote token account
 * @property [_writable_] baseVault Base vault PDA, seeds are [b'vault', market_address, base_mint_address]
 * @property [_writable_] quoteVault Quote vault PDA, seeds are [b'vault', market_address, quote_mint_address]
 * @category Instructions
 * @category PlaceLimitOrder
 * @category generated
 */
export type PlaceLimitOrderInstructionAccounts = {
  phoenixProgram: web3.PublicKey;
  logAuthority: web3.PublicKey;
  market: web3.PublicKey;
  trader: web3.PublicKey;
  seat: web3.PublicKey;
  baseAccount: web3.PublicKey;
  quoteAccount: web3.PublicKey;
  baseVault: web3.PublicKey;
  quoteVault: web3.PublicKey;
  tokenProgram?: web3.PublicKey;
};

export const placeLimitOrderInstructionDiscriminator = 2;

/**
 * Creates a _PlaceLimitOrder_ instruction.
 *
 * @param accounts that will be accessed while the instruction is processed
 * @param args to provide as instruction data to the program
 *
 * @category Instructions
 * @category PlaceLimitOrder
 * @category generated
 */
export function createPlaceLimitOrderInstruction(
  accounts: PlaceLimitOrderInstructionAccounts,
  args: PlaceLimitOrderInstructionArgs,
  programId = new web3.PublicKey("PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY")
) {
  const [data] = PlaceLimitOrderStruct.serialize({
    instructionDiscriminator: placeLimitOrderInstructionDiscriminator,
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
      pubkey: accounts.seat,
      isWritable: false,
      isSigner: false,
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

export function createPlaceLimitOrderInstructionWithClient(
  client: Client,
  args: PlaceLimitOrderInstructionArgs,
  marketAddress: String,
  trader: web3.PublicKey,
  tokenProgram?: web3.PublicKey,
  programId = new web3.PublicKey("PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY")
): web3.TransactionInstruction {
  const [data] = PlaceLimitOrderStruct.serialize({
    instructionDiscriminator: placeLimitOrderInstructionDiscriminator,
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
      pubkey: client.getSeatKey(trader, marketAddress),
      isWritable: false,
      isSigner: false,
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
