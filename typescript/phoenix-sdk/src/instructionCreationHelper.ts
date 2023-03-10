import * as splToken from "@solana/spl-token";
import * as web3 from "@solana/web3.js";
import { Client } from "client";
// import all
import * as instructions from "./instructions";

/**
 * Creates a _CancelAllOrders_ instruction.
 *
 * @param client Phoenix SDK client to use
 * @param marketAddress Market address string
 * @param trader Trader public key
 *
 * @category Instructions
 */
export function createCancelAllOrdersInstructionWithClient(
  client: Client,
  marketAddress: string,
  trader: web3.PublicKey,
  tokenProgram?: web3.PublicKey,
  programId = new web3.PublicKey("PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY")
): web3.TransactionInstruction {
  const [data] = instructions.CancelAllOrdersStruct.serialize({
    instructionDiscriminator:
      instructions.cancelAllOrdersInstructionDiscriminator,
  });

  const market = client.markets.find(
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

/**
 * Creates a _CancelAllOrdersWithFreeFunds_ instruction.
 *
 * @param client Phoenix SDK client to use
 * @param marketAddress Market address string
 * @param trader Trader public key
 * @category Instructions
 */
export function createCancelAllOrdersWithFreeFundsInstructionWithClient(
  client: Client,
  marketAddress: string,
  trader: web3.PublicKey,
  programId = new web3.PublicKey("PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY")
): web3.TransactionInstruction {
  const [data] = instructions.CancelAllOrdersWithFreeFundsStruct.serialize({
    instructionDiscriminator:
      instructions.cancelAllOrdersWithFreeFundsInstructionDiscriminator,
  });
  const market = client.markets.find(
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
  args: instructions.CancelMultipleOrdersByIdInstructionArgs,
  marketAddress: string,
  trader: web3.PublicKey,
  tokenProgram?: web3.PublicKey,
  programId = new web3.PublicKey("PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY")
): web3.TransactionInstruction {
  const [data] = instructions.CancelMultipleOrdersByIdStruct.serialize({
    instructionDiscriminator:
      instructions.cancelMultipleOrdersByIdInstructionDiscriminator,
    ...args,
  });

  const market = client.markets.find(
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

/**
 * Creates a _CancelMultipleOrdersByIdWithFreeFunds_ instruction.
 *
 * @param client Phoenix SDK client to use
 * @param args to provide as instruction data to the program
 * @param marketAddress Market address string
 * @param trader Trader public key
 *
 * @category Instructions
 */
export function createCancelMultipleOrdersByIdWithFreeFundsInstructionWithClient(
  client: Client,
  args: instructions.CancelMultipleOrdersByIdWithFreeFundsInstructionArgs,
  marketAddress: string,
  trader: web3.PublicKey,
  programId = new web3.PublicKey("PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY")
): web3.TransactionInstruction {
  const [data] =
    instructions.CancelMultipleOrdersByIdWithFreeFundsStruct.serialize({
      instructionDiscriminator:
        instructions.cancelMultipleOrdersByIdWithFreeFundsInstructionDiscriminator,
      ...args,
    });

  const market = client.markets.find(
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
  ];

  const ix = new web3.TransactionInstruction({
    programId,
    keys,
    data,
  });
  return ix;
}

/**
 * Creates a _CancelUpTo_ instruction.
 *
 * @param client Phoenix SDK client to use
 * @param args to provide as instruction data to the program
 * @param marketAddress Market address string
 * @param trader Trader public key
 *
 * @category Instructions
 */
export function createCancelUpToInstructionWithClient(
  client: Client,
  args: instructions.CancelUpToInstructionArgs,
  marketAddress: string,
  trader: web3.PublicKey,
  tokenProgram?: web3.PublicKey,
  programId = new web3.PublicKey("PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY")
): web3.TransactionInstruction {
  const [data] = instructions.CancelUpToStruct.serialize({
    instructionDiscriminator: instructions.cancelUpToInstructionDiscriminator,
    ...args,
  });

  const market = client.markets.find(
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

/**
 * Creates a _CancelUpToWithFreeFunds_ instruction.
 *
 * @param client Phoenix SDK client to use
 * @param args to provide as instruction data to the program
 * @param marketAddress Market address string
 * @param trader Trader public key
 *
 * @category Instructions
 */
export function createCancelUpToWithFreeFundsInstructionWithClient(
  client: Client,
  args: instructions.CancelUpToWithFreeFundsInstructionArgs,
  marketAddress: string,
  trader: web3.PublicKey,
  programId = new web3.PublicKey("PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY")
): web3.TransactionInstruction {
  const [data] = instructions.CancelUpToWithFreeFundsStruct.serialize({
    instructionDiscriminator:
      instructions.cancelUpToWithFreeFundsInstructionDiscriminator,
    ...args,
  });

  const market = client.markets.find(
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
  ];

  const ix = new web3.TransactionInstruction({
    programId,
    keys,
    data,
  });
  return ix;
}

/**
 * Creates a _DepositFunds_ instruction.
 *
 * @param client Phoenix SDK client to use
 * @param args to provide as instruction data to the program
 * @param marketAddress Market address string
 * @param trader Trader public key
 *
 * @category Instructions
 */
export function createDepositFundsInstructionWithClient(
  client: Client,
  args: instructions.DepositFundsInstructionArgs,
  marketAddress: string,
  trader: web3.PublicKey,
  tokenProgram?: web3.PublicKey,
  programId = new web3.PublicKey("PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY")
): web3.TransactionInstruction {
  const [data] = instructions.DepositFundsStruct.serialize({
    instructionDiscriminator: instructions.depositFundsInstructionDiscriminator,
    ...args,
  });
  const market = client.markets.find(
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

/**
 * Creates a _Log_ instruction.
 *
 * @param client Phoenix SDK client to use
 * @category Instructions
 */
export function createLogInstructionWithClient(
  client: Client,
  programId = new web3.PublicKey("PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY")
) {
  const [data] = instructions.LogStruct.serialize({
    instructionDiscriminator: instructions.logInstructionDiscriminator,
  });

  const keys: web3.AccountMeta[] = [
    {
      pubkey: client.getLogAuthority(),
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

/**
 * Creates a _PlaceLimitOrder_ instruction.
 *
 * @param client Phoenix SDK client to use
 * @param args to provide as instruction data to the program
 * @param marketAddress Market address string
 * @param trader Trader public key
 *
 * @category Instructions
 */
export function createPlaceLimitOrderInstructionWithClient(
  client: Client,
  args: instructions.PlaceLimitOrderInstructionArgs,
  marketAddress: string,
  trader: web3.PublicKey,
  tokenProgram?: web3.PublicKey,
  programId = new web3.PublicKey("PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY")
): web3.TransactionInstruction {
  const [data] = instructions.PlaceLimitOrderStruct.serialize({
    instructionDiscriminator:
      instructions.placeLimitOrderInstructionDiscriminator,
    ...args,
  });
  const market = client.markets.find(
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

/**
 * Creates a _PlaceLimitOrderWithFreeFunds_ instruction.
 *
 * @param client Phoenix SDK client to use
 * @param args to provide as instruction data to the program
 * @param marketAddress Market address string
 * @param trader Trader public key
 *
 * @category Instructions
 */
export function createPlaceLimitOrderWithFreeFundsInstructionWithClient(
  client: Client,
  args: instructions.PlaceLimitOrderWithFreeFundsInstructionArgs,
  marketAddress: string,
  trader: web3.PublicKey,
  programId = new web3.PublicKey("PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY")
) {
  const [data] = instructions.PlaceLimitOrderWithFreeFundsStruct.serialize({
    instructionDiscriminator:
      instructions.placeLimitOrderWithFreeFundsInstructionDiscriminator,
    ...args,
  });

  const market = client.markets.find(
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
  ];

  const ix = new web3.TransactionInstruction({
    programId,
    keys,
    data,
  });
  return ix;
}

/**
 * Creates a _PlaceMultiplePostOnlyOrders_ instruction.
 *
 * @param client Phoenix SDK client to use
 * @param args to provide as instruction data to the program
 * @param marketAddress Market address string
 * @param trader Trader public key
 *
 * @category Instructions
 */
export function createPlaceMultiplePostOnlyOrdersInstructionWithClient(
  client: Client,
  args: instructions.PlaceMultiplePostOnlyOrdersInstructionArgs,
  marketAddress: string,
  trader: web3.PublicKey,
  tokenProgram?: web3.PublicKey,
  programId = new web3.PublicKey("PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY")
): web3.TransactionInstruction {
  const [data] = instructions.PlaceMultiplePostOnlyOrdersStruct.serialize({
    instructionDiscriminator:
      instructions.placeMultiplePostOnlyOrdersInstructionDiscriminator,
    ...args,
  });
  const market = client.markets.find(
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

/**
 * Creates a _PlaceMultiplePostOnlyOrdersWithFreeFunds_ instruction.
 *
 * @param client Phoenix SDK client to use
 * @param args to provide as instruction data to the program
 * @param marketAddress Market address string
 * @param trader Trader public key
 *
 * @category Instructions
 */
export function createPlaceMultiplePostOnlyOrdersWithFreeFundsInstructionWithClient(
  client: Client,
  args: instructions.PlaceMultiplePostOnlyOrdersWithFreeFundsInstructionArgs,
  marketAddress: string,
  trader: web3.PublicKey,
  programId = new web3.PublicKey("PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY")
) {
  const [data] =
    instructions.PlaceMultiplePostOnlyOrdersWithFreeFundsStruct.serialize({
      instructionDiscriminator:
        instructions.placeMultiplePostOnlyOrdersWithFreeFundsInstructionDiscriminator,
      ...args,
    });
  const market = client.markets.find(
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
  ];

  const ix = new web3.TransactionInstruction({
    programId,
    keys,
    data,
  });
  return ix;
}

/**
 * Creates a _ReduceOrder_ instruction.
 *
 * @param client Phoenix SDK client to use
 * @param args to provide as instruction data to the program
 * @param marketAddress Market address string
 * @param trader Trader public key
 *
 * @category Instructions
 */
export function createReduceOrderInstructionWithClient(
  client: Client,
  args: instructions.ReduceOrderInstructionArgs,
  marketAddress: string,
  trader: web3.PublicKey,
  tokenProgram?: web3.PublicKey,
  programId = new web3.PublicKey("PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY")
) {
  const [data] = instructions.ReduceOrderStruct.serialize({
    instructionDiscriminator: instructions.reduceOrderInstructionDiscriminator,
    ...args,
  });
  const market = client.markets.find(
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

/**
 * Creates a _ReduceOrderWithFreeFunds_ instruction.
 *
 * @param client Phoenix SDK client to use
 * @param args to provide as instruction data to the program
 * @param marketAddress Market address string
 * @param trader Trader public key
 *
 * @category Instructions
 */
export function createReduceOrderWithFreeFundsInstructionWithClient(
  client: Client,
  args: instructions.ReduceOrderWithFreeFundsInstructionArgs,
  marketAddress: string,
  trader: web3.PublicKey,
  programId = new web3.PublicKey("PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY")
) {
  const [data] = instructions.ReduceOrderWithFreeFundsStruct.serialize({
    instructionDiscriminator:
      instructions.reduceOrderWithFreeFundsInstructionDiscriminator,
    ...args,
  });
  const market = client.markets.find(
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
  ];

  const ix = new web3.TransactionInstruction({
    programId,
    keys,
    data,
  });
  return ix;
}

/**
 * Creates a _RequestSeat_ instruction.
 *
 * @param client Phoenix SDK client to use
 * @param marketAddress Market address string
 * @param payer Payer public key
 * @param trader Trader public key
 *
 * @category Instructions
 */
export function createRequestSeatInstructionWithClient(
  client: Client,
  marketAddress: string,
  payer: web3.PublicKey,
  trader: web3.PublicKey,
  tokenProgram?: web3.PublicKey,
  programId = new web3.PublicKey("PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY")
) {
  const [data] = instructions.RequestSeatStruct.serialize({
    instructionDiscriminator: instructions.requestSeatInstructionDiscriminator,
  });

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
      pubkey: payer,
      isWritable: true,
      isSigner: true,
    },
    {
      pubkey: client.getSeatKey(trader, marketAddress),
      isWritable: false,
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

/**
 * Creates a _Swap_ instruction.
 *
 * @param client Phoenix SDK client to use
 * @param args to provide as instruction data to the program
 * @param marketAddress Market address string
 * @param trader Trader public key
 *
 * @category Instructions
 */
export function createSwapInstructionWithClient(
  client: Client,
  args: instructions.SwapInstructionArgs,
  marketAddress: string,
  trader: web3.PublicKey,
  tokenProgram?: web3.PublicKey,
  programId = new web3.PublicKey("PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY")
): web3.TransactionInstruction {
  const [data] = instructions.SwapStruct.serialize({
    instructionDiscriminator: instructions.swapInstructionDiscriminator,
    ...args,
  });
  const market = client.markets.find(
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

/**
 * Creates a _SwapWithFreeFunds_ instruction.
 *
 * @param client Phoenix SDK client to use
 * @param args to provide as instruction data to the program
 * @param marketAddress Market address string
 * @param trader Trader public key
 *
 * @category Instructions
 */
export function createSwapWithFreeFundsInstructionWithClient(
  client: Client,
  args: instructions.SwapWithFreeFundsInstructionArgs,
  marketAddress: string,
  trader: web3.PublicKey,
  programId = new web3.PublicKey("PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY")
) {
  const [data] = instructions.SwapWithFreeFundsStruct.serialize({
    instructionDiscriminator:
      instructions.swapWithFreeFundsInstructionDiscriminator,
    ...args,
  });

  const market = client.markets.find(
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
  ];

  const ix = new web3.TransactionInstruction({
    programId,
    keys,
    data,
  });
  return ix;
}

/**
 * Creates a _WithdrawFunds_ instruction.
 *
 * @param client Phoenix SDK client to use
 * @param args to provide as instruction data to the program
 * @param marketAddress Market address string
 * @param trader Trader public key
 *
 * @category Instructions
 */
export function createWithdrawFundsInstructionWithClient(
  client: Client,
  args: instructions.WithdrawFundsInstructionArgs,
  marketAddress: string,
  trader: web3.PublicKey,
  tokenProgram?: web3.PublicKey,
  programId = new web3.PublicKey("PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY")
): web3.TransactionInstruction {
  const [data] = instructions.WithdrawFundsStruct.serialize({
    instructionDiscriminator:
      instructions.withdrawFundsInstructionDiscriminator,
    ...args,
  });
  const market = client.markets.find(
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
