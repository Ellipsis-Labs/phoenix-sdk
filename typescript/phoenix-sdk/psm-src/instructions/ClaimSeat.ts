/**
 * This code was GENERATED using the solita package.
 * Please DO NOT EDIT THIS FILE, instead rerun solita to update it or write a wrapper to add functionality.
 *
 * See: https://github.com/metaplex-foundation/solita
 */

import * as beet from "@metaplex-foundation/beet";
import * as web3 from "@solana/web3.js";

/**
 * @category Instructions
 * @category ClaimSeat
 * @category generated
 */
export const ClaimSeatStruct = new beet.BeetArgsStruct<{
  instructionDiscriminator: number;
}>([["instructionDiscriminator", beet.u8]], "ClaimSeatInstructionArgs");
/**
 * Accounts required by the _ClaimSeat_ instruction
 *
 * @property [] phoenixProgram Phoenix program
 * @property [] logAuthority Phoenix log authority
 * @property [_writable_] market This account holds the market state
 * @property [_writable_] seatManager The seat manager account is the market authority
 * @property [_writable_] seatDepositCollector Collects deposits for claiming new seats and refunds for evicting seats
 * @property [**signer**] trader
 * @property [_writable_, **signer**] payer
 * @property [_writable_] seat
 * @category Instructions
 * @category ClaimSeat
 * @category generated
 */
export type ClaimSeatInstructionAccounts = {
  phoenixProgram: web3.PublicKey;
  logAuthority: web3.PublicKey;
  market: web3.PublicKey;
  seatManager: web3.PublicKey;
  seatDepositCollector: web3.PublicKey;
  trader: web3.PublicKey;
  payer: web3.PublicKey;
  seat: web3.PublicKey;
  systemProgram?: web3.PublicKey;
};

export const claimSeatInstructionDiscriminator = 1;

/**
 * Creates a _ClaimSeat_ instruction.
 *
 * @param accounts that will be accessed while the instruction is processed
 * @category Instructions
 * @category ClaimSeat
 * @category generated
 */
export function createClaimSeatInstruction(
  accounts: ClaimSeatInstructionAccounts,
  programId = new web3.PublicKey("PSMxQbAoDWDbvd9ezQJgARyq6R9L5kJAasaLDVcZwf1")
) {
  const [data] = ClaimSeatStruct.serialize({
    instructionDiscriminator: claimSeatInstructionDiscriminator,
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
      pubkey: accounts.seatManager,
      isWritable: true,
      isSigner: false,
    },
    {
      pubkey: accounts.seatDepositCollector,
      isWritable: true,
      isSigner: false,
    },
    {
      pubkey: accounts.trader,
      isWritable: false,
      isSigner: true,
    },
    {
      pubkey: accounts.payer,
      isWritable: true,
      isSigner: true,
    },
    {
      pubkey: accounts.seat,
      isWritable: true,
      isSigner: false,
    },
    {
      pubkey: accounts.systemProgram ?? web3.SystemProgram.programId,
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
