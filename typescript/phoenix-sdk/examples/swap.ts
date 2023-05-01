import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import base58 from "bs58";

import * as Phoenix from "../src";
import { isPhoenixMarketEventFillSummary } from "../src";

export async function swap() {
  const connection = new Connection("https://qn-devnet.solana.fm/");
  // DO NOT USE THIS KEYPAIR IN PRODUCTION
  const trader = Keypair.fromSecretKey(
    base58.decode(
      "2PKwbVQ1YMFEexCmUDyxy8cuwb69VWcvoeodZCLegqof84DJSTiEd89Ak3so9CiHycZwynesTt1JUDFAPFWEzvVs"
    )
  );

  const marketAddress = new PublicKey(
    "CS2H8nbAVVEUHWPF5extCSymqheQdkd4d7thik6eet9N"
  );
  const marketAccount = await connection.getAccountInfo(
    marketAddress,
    "confirmed"
  );
  if (!marketAccount) {
    throw Error(
      "Market account not found for address: " + marketAddress.toBase58()
    );
  }

  const client = await Phoenix.Client.createWithMarketAddresses(
    connection,
    "devnet",
    [marketAddress]
  );

  const market = client.markets.get(marketAddress.toBase58());
  if (market === undefined) {
    throw Error("Market not found");
  }

  const side = Math.random() > 0.5 ? Phoenix.Side.Ask : Phoenix.Side.Bid;
  const inAmount =
    side === Phoenix.Side.Ask
      ? Math.floor(Math.random() * 4) + 1
      : Math.floor(Math.random() * 100) + 50;
  const slippage = 0.008;
  console.log(
    side === Phoenix.Side.Ask ? "Selling" : "Market buy",
    inAmount,
    side === Phoenix.Side.Ask ? "SOL" : "USDC",
    "with",
    slippage * 100,
    "% slippage"
  );

  // Generate an IOC order packet
  const orderPacket = market.getSwapOrderPacket({
    side,
    inAmount,
    slippage,
  });
  // Generate a swap instruction from the order packet
  const swapIx = market.createSwapInstruction(orderPacket, trader.publicKey);
  // Create a transaction with the swap instruction
  const swapTx = new Transaction().add(swapIx);

  const expectedOutAmount = client.getMarketExpectedOutAmount({
    marketAddress: marketAddress.toBase58(),
    side,
    inAmount,
  });
  console.log(
    "Expected out amount:",
    expectedOutAmount,
    side === Phoenix.Side.Ask ? "USDC" : "SOL"
  );

  const txId = await sendAndConfirmTransaction(connection, swapTx, [trader], {
    commitment: "confirmed",
  });
  console.log("Transaction ID:", txId);
  const txResult = await Phoenix.getPhoenixEventsFromTransactionSignature(
    connection,
    txId
  );

  if (txResult.txFailed) {
    console.log("Swap transaction failed");
    return;
  }

  const fillEvents = txResult.instructions[0];

  const summaryEvent = fillEvents.events[fillEvents.events.length - 1];
  if (!isPhoenixMarketEventFillSummary(summaryEvent)) {
    throw Error(`Unexpected event type: ${summaryEvent}`);
  }

  // This is pretty sketch
  const summary: Phoenix.FillSummaryEvent = summaryEvent.fields[0];

  if (side == Phoenix.Side.Bid) {
    console.log(
      "Filled",
      market.baseLotsToRawBaseUnits(Phoenix.toNum(summary.totalBaseLotsFilled)),
      "SOL"
    );
  } else {
    console.log(
      "Sold",
      inAmount,
      "SOL for",
      market.quoteLotsToQuoteUnits(Phoenix.toNum(summary.totalQuoteLotsFilled)),
      "USDC"
    );
  }

  const fees = market.quoteLotsToQuoteUnits(
    Phoenix.toNum(summary.totalFeeInQuoteLots)
  );
  console.log(`Paid ${fees} in fees`);
}

(async function () {
  for (let i = 0; i < 10; i++) {
    console.log("Swap", i + 1, "of", 10);
    try {
      await swap();
      await new Promise((resolve) => setTimeout(resolve, 1000));
      console.log();
    } catch (err) {
      console.log("Error: ", err);
      process.exit(1);
    }
  }

  process.exit(0);
})();
