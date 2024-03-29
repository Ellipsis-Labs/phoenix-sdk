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
 * @category ChangeMarketFeeRecipient
 * @category generated
 */
export const ChangeMarketFeeRecipientStruct = new beet.BeetArgsStruct<{
  instructionDiscriminator: number;
}>(
  [["instructionDiscriminator", beet.u8]],
  "ChangeMarketFeeRecipientInstructionArgs"
);
/**
 * Accounts required by the _ChangeMarketFeeRecipient_ instruction
 *
 * @property [] phoenixProgram Phoenix program
 * @property [] logAuthority Phoenix log authority
 * @property [_writable_] market This account holds the market state
 * @property [**signer**] marketAuthority The market_authority account must sign to change the fee recipient
 * @property [**signer**] seatManagerAuthority The seat manager authority must sign to change the fee recipient
 * @property [_writable_] currentFeeRecipientQuoteTokenAcocunt The current fee recipient's quote token account
 * @property [_writable_] quoteVault The quote vault account
 * @property [] newFeeRecipient Account to become the new recipient of fees
 * @property [] splToken The SPL token program
 * @category Instructions
 * @category ChangeMarketFeeRecipient
 * @category generated
 */
export type ChangeMarketFeeRecipientInstructionAccounts = {
  phoenixProgram: web3.PublicKey;
  logAuthority: web3.PublicKey;
  market: web3.PublicKey;
  marketAuthority: web3.PublicKey;
  seatManagerAuthority: web3.PublicKey;
  currentFeeRecipientQuoteTokenAcocunt: web3.PublicKey;
  quoteVault: web3.PublicKey;
  newFeeRecipient: web3.PublicKey;
  splToken: web3.PublicKey;
};

export const changeMarketFeeRecipientInstructionDiscriminator = 10;

/**
 * Creates a _ChangeMarketFeeRecipient_ instruction.
 *
 * @param accounts that will be accessed while the instruction is processed
 * @category Instructions
 * @category ChangeMarketFeeRecipient
 * @category generated
 */
export function createChangeMarketFeeRecipientInstruction(
  accounts: ChangeMarketFeeRecipientInstructionAccounts,
  programId = new web3.PublicKey("PSMxQbAoDWDbvd9ezQJgARyq6R9L5kJAasaLDVcZwf1")
) {
  const [data] = ChangeMarketFeeRecipientStruct.serialize({
    instructionDiscriminator: changeMarketFeeRecipientInstructionDiscriminator,
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
      pubkey: accounts.marketAuthority,
      isWritable: false,
      isSigner: true,
    },
    {
      pubkey: accounts.seatManagerAuthority,
      isWritable: false,
      isSigner: true,
    },
    {
      pubkey: accounts.currentFeeRecipientQuoteTokenAcocunt,
      isWritable: true,
      isSigner: false,
    },
    {
      pubkey: accounts.quoteVault,
      isWritable: true,
      isSigner: false,
    },
    {
      pubkey: accounts.newFeeRecipient,
      isWritable: false,
      isSigner: false,
    },
    {
      pubkey: accounts.splToken,
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
