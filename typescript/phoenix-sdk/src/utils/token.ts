import { Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";

// Check if associated token account exists. If not, return create associated token account instructions
export async function getCreateTokenAccountInstructions(
  connection: Connection,
  trader: PublicKey,
  payer: PublicKey,
  tokenMintAddress: PublicKey
): Promise<TransactionInstruction[]> {
  const associatedTokenAccountAddress = await getAssociatedTokenAddress(
    tokenMintAddress,
    trader
  );

  const ata = await connection.getAccountInfo(
    associatedTokenAccountAddress,
    "confirmed"
  );
  const ixs: TransactionInstruction[] = [];
  if (ata === null || ata.data.length == 0) {
    ixs.push(
      createAssociatedTokenAccountInstruction(
        payer,
        associatedTokenAccountAddress,
        trader,
        tokenMintAddress
      )
    );
  }
  return ixs;
}
