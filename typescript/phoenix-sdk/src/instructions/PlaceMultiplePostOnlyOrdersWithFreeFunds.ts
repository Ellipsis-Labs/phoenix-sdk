/**
 * This code was GENERATED using the solita package.
 * Please DO NOT EDIT THIS FILE, instead rerun solita to update it or write a wrapper to add functionality.
 *
 * See: https://github.com/metaplex-foundation/solita
 */

import * as beet from "@metaplex-foundation/beet";
import * as web3 from "@solana/web3.js";
import {
  MultipleOrderPacket,
  multipleOrderPacketBeet,
} from "../types/MultipleOrderPacket";

/**
 * @category Instructions
 * @category PlaceMultiplePostOnlyOrdersWithFreeFunds
 * @category generated
 */
export const PlaceMultiplePostOnlyOrdersWithFreeFundsStruct =
  new beet.FixableBeetArgsStruct<{
    instructionDiscriminator: number;
    orders: MultipleOrderPacket;
  }>(
    [
      ["instructionDiscriminator", beet.u8],
      ["orders", multipleOrderPacketBeet],
    ],
    "PlaceMultiplePostOnlyOrdersWithFreeFundsInstructionArgs"
  );
/**
 * Accounts required by the _PlaceMultiplePostOnlyOrdersWithFreeFunds_ instruction
 *
 * @property [] phoenixProgram Phoenix program
 * @property [] logAuthority Phoenix log authority
 * @property [_writable_] market This account holds the market state
 * @property [_writable_, **signer**] trader
 * @property [] seat
 * @category Instructions
 * @category PlaceMultiplePostOnlyOrdersWithFreeFunds
 * @category generated
 */
export type PlaceMultiplePostOnlyOrdersWithFreeFundsInstructionAccounts = {
  phoenixProgram: web3.PublicKey;
  logAuthority: web3.PublicKey;
  market: web3.PublicKey;
  trader: web3.PublicKey;
  seat: web3.PublicKey;
};

export const placeMultiplePostOnlyOrdersWithFreeFundsInstructionDiscriminator = 17;

/**
 * Creates a _PlaceMultiplePostOnlyOrdersWithFreeFunds_ instruction.
 *
 * @param accounts that will be accessed while the instruction is processed
 * @category Instructions
 * @category PlaceMultiplePostOnlyOrdersWithFreeFunds
 * @category generated
 */
export function createPlaceMultiplePostOnlyOrdersWithFreeFundsInstruction(
  accounts: PlaceMultiplePostOnlyOrdersWithFreeFundsInstructionAccounts,
  orders: MultipleOrderPacket,
  programId = new web3.PublicKey("phnxNHfGNVjpVVuHkceK3MgwZ1bW25ijfWACKhVFbBH")
) {
  const [data] = PlaceMultiplePostOnlyOrdersWithFreeFundsStruct.serialize({
    instructionDiscriminator:
      placeMultiplePostOnlyOrdersWithFreeFundsInstructionDiscriminator,
    orders,
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
      isWritable: true,
      isSigner: true,
    },
    {
      pubkey: accounts.seat,
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
