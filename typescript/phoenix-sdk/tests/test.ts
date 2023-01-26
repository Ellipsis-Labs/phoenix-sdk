import {
  Connection,
  Keypair,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import base58 from "bs58";

import { FillSummaryEvent } from "../src/index";
import { getEventsFromTransaction } from "../src/events";
import { Side } from "../src/types";
import { toNum } from "../src/utils";
import * as Phoenix from "../src/client";

async function main() {
  const connection = new Connection("https://qn-devnet.solana.fm/");
  // DO NOT USE THIS KEYPAIR IN PRODUCTION
  const traderKeypair = Keypair.fromSecretKey(
    base58.decode(
      "2PKwbVQ1YMFEexCmUDyxy8cuwb69VWcvoeodZCLegqof84DJSTiEd89Ak3so9CiHycZwynesTt1JUDFAPFWEzvVs"
    )
  );

  const phoenix = await Phoenix.Client.create(connection);
  const market = phoenix.markets.find((market) => market.name === "SOL/USDC");
  if (!market) {
    throw Error("SOL/USDC market not found");
  }

  const side = Math.random() > 0.5 ? Side.Ask : Side.Bid;
  const inAmount = side === Side.Ask ? 1 : 100;
  console.log(
    side === Side.Ask
      ? `Selling ${inAmount} SOL`
      : `Market buy with ${inAmount} USDC`
  );

  const swapTransaction = market.getSwapTransaction({
    side,
    inAmount,
    trader: traderKeypair.publicKey,
  });

  const txId = await sendAndConfirmTransaction(
    connection,
    swapTransaction,
    [traderKeypair],
    { skipPreflight: true, commitment: "confirmed" }
  );
  console.log("Transaction ID: ", txId);

  // Retry until we get the transaction. We give up after 10 tries
  let txResult = await getEventsFromTransaction(connection, txId);
  let counter = 1;
  while (txResult.instructions.length == 0) {
    txResult = await getEventsFromTransaction(connection, txId);
    counter += 1;
    if (counter == 10) {
      throw Error("Failed to fetch tranxaction");
    }
  }
  console.log("Fetched transaction after", counter, "attempt(s)");
  const fillEvents = txResult.instructions[0];

  let summary = fillEvents.events[
    fillEvents.events.length - 1
  ] as FillSummaryEvent;

  if (side == Side.Bid) {
    console.log(
      "Filled",
      toNum(summary.totalBaseLotsFilled) / market.data.baseLotsPerBaseUnit,
      "SOL"
    );
  } else {
    console.log(
      `Sold ${inAmount} SOL for`,
      (toNum(summary.totalQuoteLotsFilled) *
        toNum(market.data.header.quoteLotSize)) /
        10 ** market.data.header.quoteParams.decimals,
      "USDC"
    );
  }
  let fees =
    (toNum(summary.totalFeeInQuoteLots) *
      toNum(market.data.header.quoteLotSize)) /
    10 ** market.data.header.quoteParams.decimals;

  console.log(`Paid $${fees} in fees:`);
}

main()
  .then((_) => {
    console.log("Done");
  })
  .catch((err) => {
    console.log(err);
  });
