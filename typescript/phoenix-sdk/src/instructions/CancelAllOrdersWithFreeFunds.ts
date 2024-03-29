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
 * @category CancelAllOrdersWithFreeFunds
 * @category generated
 */
export const CancelAllOrdersWithFreeFundsStruct = new beet.BeetArgsStruct<{
  instructionDiscriminator: number;
}>(
  [["instructionDiscriminator", beet.u8]],
  "CancelAllOrdersWithFreeFundsInstructionArgs"
);
/**
 * Accounts required by the _CancelAllOrdersWithFreeFunds_ instruction
 *
 * @property [] phoenixProgram Phoenix program
 * @property [] logAuthority Phoenix log authority
 * @property [_writable_] market This account holds the market state
 * @property [**signer**] trader
 * @category Instructions
 * @category CancelAllOrdersWithFreeFunds
 * @category generated
 */
export type CancelAllOrdersWithFreeFundsInstructionAccounts = {
  phoenixProgram: web3.PublicKey;
  logAuthority: web3.PublicKey;
  market: web3.PublicKey;
  trader: web3.PublicKey;
};

export const cancelAllOrdersWithFreeFundsInstructionDiscriminator = 7;

/**
 * Creates a _CancelAllOrdersWithFreeFunds_ instruction.
 *
 * @param accounts that will be accessed while the instruction is processed
 * @category Instructions
 * @category CancelAllOrdersWithFreeFunds
 * @category generated
 */
export function createCancelAllOrdersWithFreeFundsInstruction(
  accounts: CancelAllOrdersWithFreeFundsInstructionAccounts,
  programId = new web3.PublicKey("PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY")
) {
  const [data] = CancelAllOrdersWithFreeFundsStruct.serialize({
    instructionDiscriminator:
      cancelAllOrdersWithFreeFundsInstructionDiscriminator,
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
  ];

  const ix = new web3.TransactionInstruction({
    programId,
    keys,
    data,
  });
  return ix;
}
