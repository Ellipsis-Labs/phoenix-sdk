import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import base58 from "bs58";

import * as Phoenix from "../src";

export async function swap() {
  const connection = new Connection("https://qn-devnet.solana.fm/");
  // DO NOT USE THIS KEYPAIR IN PRODUCTION
  const trader = Keypair.fromSecretKey(
    base58.decode(
      "2PKwbVQ1YMFEexCmUDyxy8cuwb69VWcvoeodZCLegqof84DJSTiEd89Ak3so9CiHycZwynesTt1JUDFAPFWEzvVs"
    )
  );

  const marketAddress = new PublicKey(
    "5iLqmcg8vifdnnw6wEpVtQxFE4Few5uiceDWzi3jvzH8"
  );
  const marketAccount = await connection.getAccountInfo(marketAddress);
  if (!marketAccount)
    throw Error(
      "Market account not found for address: " + marketAddress.toBase58()
    );
  const marketData = Phoenix.deserializeMarketData(
    Buffer.from(marketAccount.data)
  );

  const side = Math.random() > 0.5 ? Phoenix.Side.Ask : Phoenix.Side.Bid;
  const inAmount = side === Phoenix.Side.Ask ? 1 : 100;
  const slippage = 0.08;
  console.log(
    side === Phoenix.Side.Ask ? "Selling" : "Market buy",
    inAmount,
    side === Phoenix.Side.Ask ? "SOL" : "USDC",
    "with",
    slippage * 100,
    "% slippage"
  );

  const baseAccount = PublicKey.findProgramAddressSync(
    [
      trader.publicKey.toBuffer(),
      TOKEN_PROGRAM_ID.toBuffer(),
      marketData.header.baseParams.mintKey.toBuffer(),
    ],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];
  const quoteAccount = PublicKey.findProgramAddressSync(
    [
      trader.publicKey.toBuffer(),
      TOKEN_PROGRAM_ID.toBuffer(),
      marketData.header.quoteParams.mintKey.toBuffer(),
    ],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];
  const logAuthority = PublicKey.findProgramAddressSync(
    [Buffer.from("log")],
    Phoenix.PROGRAM_ID
  )[0];

  const orderAccounts = {
    phoenixProgram: Phoenix.PROGRAM_ID,
    logAuthority,
    market: marketAddress,
    trader: trader.publicKey,
    baseAccount,
    quoteAccount,
    quoteVault: marketData.header.quoteParams.vaultKey,
    baseVault: marketData.header.baseParams.vaultKey,
  };

  const orderPacket = Phoenix.getMarketSwapOrderPacket({
    marketData,
    side,
    inAmount,
    slippage,
  });

  const swapIx = Phoenix.createSwapInstruction(orderAccounts, {
    // @ts-ignore TODO why is __kind incompatible?
    orderPacket: {
      __kind: "ImmediateOrCancel",
      ...orderPacket,
    },
  });

  const controlTx = new Transaction().add(swapIx);

  const swapTx = Phoenix.getMarketSwapTransaction({
    marketAddress,
    marketData,
    trader: trader.publicKey,
    side,
    inAmount,
    slippage,
  });

  if (JSON.stringify(controlTx) !== JSON.stringify(swapTx))
    throw Error(
      "Manually created transaction does not match the one created by the SDK"
    );

  const expectedOutAmount = Phoenix.getExpectedOutAmount({
    marketData,
    side,
    inAmount,
  });
  console.log(
    "Expected out amount:",
    expectedOutAmount,
    side === Phoenix.Side.Ask ? "USDC" : "SOL"
  );

  const txId = await sendAndConfirmTransaction(connection, swapTx, [trader], {
    skipPreflight: true,
    commitment: "confirmed",
  });
  console.log("Transaction ID: ", txId);

  // Wait for transaction to be confirmed (up to 10 tries)
  let txResult = await Phoenix.getEventsFromTransaction(connection, txId);
  let counter = 1;
  while (txResult.instructions.length == 0) {
    txResult = await Phoenix.getEventsFromTransaction(connection, txId);
    counter += 1;
    if (counter == 10) {
      throw Error("Failed to fetch transaction");
    }
  }
  const fillEvents = txResult.instructions[0];

  const summary = fillEvents.events[
    fillEvents.events.length - 1
  ] as Phoenix.FillSummaryEvent;

  if (side == Phoenix.Side.Bid) {
    console.log(
      "Filled",
      Phoenix.toNum(summary.totalBaseLotsFilled) /
        marketData.baseLotsPerBaseUnit,
      "SOL"
    );
  } else {
    console.log(
      "Sold",
      inAmount,
      "SOL for",
      (Phoenix.toNum(summary.totalQuoteLotsFilled) *
        Phoenix.toNum(marketData.header.quoteLotSize)) /
        10 ** marketData.header.quoteParams.decimals,
      "USDC"
    );
  }

  const fees =
    (Phoenix.toNum(summary.totalFeeInQuoteLots) *
      Phoenix.toNum(marketData.header.quoteLotSize)) /
    10 ** marketData.header.quoteParams.decimals;
  console.log(`Paid $${fees} in fees`);
}

(async function () {
  for (let i = 0; i < 10; i++) {
    console.log("Swap", i + 1, "of", 10);
    try {
      await swap();
      console.log("Done \n");
    } catch (err) {
      console.log("Error: ", err);
      process.exit(1);
    }
  }

  process.exit(0);
})();
