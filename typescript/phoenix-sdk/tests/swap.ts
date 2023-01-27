import {
  Connection,
  Keypair,
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

  const phoenix = await Phoenix.Client.create(connection);
  const market = phoenix.markets.find((market) => market.name === "SOL/USDC");
  if (!market) throw Error("SOL/USDC market not found");

  const side = Math.random() > 0.5 ? Phoenix.Side.Ask : Phoenix.Side.Bid;
  const inAmount = side === Phoenix.Side.Ask ? 1 : 100;
  console.log(
    side === Phoenix.Side.Ask ? "Selling" : "Market buy",
    inAmount,
    side === Phoenix.Side.Ask ? "SOL" : "USDC"
  );

  const swapTransaction = market.getSwapTransaction({
    side,
    inAmount,
    trader: trader.publicKey,
  });

  const txId = await sendAndConfirmTransaction(
    connection,
    swapTransaction,
    [trader],
    { skipPreflight: true, commitment: "confirmed" }
  );
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
        market.data.baseLotsPerBaseUnit,
      "SOL"
    );
  } else {
    console.log(
      "Sold",
      inAmount,
      "SOL for",
      (Phoenix.toNum(summary.totalQuoteLotsFilled) *
        Phoenix.toNum(market.data.header.quoteLotSize)) /
        10 ** market.data.header.quoteParams.decimals,
      "USDC"
    );
  }

  const fees =
    (Phoenix.toNum(summary.totalFeeInQuoteLots) *
      Phoenix.toNum(market.data.header.quoteLotSize)) /
    10 ** market.data.header.quoteParams.decimals;
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
