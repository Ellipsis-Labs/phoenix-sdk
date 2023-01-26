import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
} from "@solana/web3.js";
import { deserializeMarket, toNum } from "../src/market";
import { getEventsFromTransaction } from "../src/events";
import { Side } from "../src/types/Side";
import { SelfTradeBehavior } from "../src/types/SelfTradeBehavior";
import {
  createSwapInstruction,
  FillEvent,
  FillSummaryEvent,
  orderPacketBeet,
  PROGRAM_ID,
} from "../src/index";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import base58 from "bs58";

const getAta = (walletAddress: PublicKey, mint: PublicKey) => {
  return PublicKey.findProgramAddressSync(
    [walletAddress.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];
};

async function main() {
  let connection = new Connection("https://qn-devnet.solana.fm/", "confirmed");
  let marketKey = new PublicKey("5iLqmcg8vifdnnw6wEpVtQxFE4Few5uiceDWzi3jvzH8");

  let marketAccount = await connection.getAccountInfo(marketKey, "confirmed");
  let market = deserializeMarket(marketAccount!.data);

  console.log(market.getUiLadder(5));
  let events = await getEventsFromTransaction(
    connection,
    "455HXmYu2W96qkihAYqrqs7namgy5ajGWZe8HYMENyfxjc4bTHPeGNsxkQdUiUwBsox1VnCKifiF5LXTjMcyRWuJ"
  );

  // This is a throwaway keypair. To state the obvious, don't use this keypair for anything in production.
  let traderKeypair = Keypair.fromSecretKey(
    base58.decode(
      "2PKwbVQ1YMFEexCmUDyxy8cuwb69VWcvoeodZCLegqof84DJSTiEd89Ak3so9CiHycZwynesTt1JUDFAPFWEzvVs"
    )
  );

  let ioc = {
    side: Side.Bid,
    priceInTicks: null,
    numQuoteLots: 100 * 10 ** 6,
    minBaseLotsToFill: 0,
    numBaseLots: 0,
    minQuoteLotsToFill: 0,
    selfTradeBehavior: SelfTradeBehavior.Abort,
    matchLimit: 2048,
    clientOrderId: 0,
    useOnlyDepositedFunds: false,
  };

  if (Math.random() > 0.5) {
    console.log("Selling 10 SOL");
    ioc.side = Side.Ask;
    ioc.numQuoteLots = 0;
    ioc.numBaseLots = 10 * market.baseLotsPerBaseUnit; // 10 SOL
  } else {
    console.log("Market buy with 100 USDC");
  }

  let ix = createSwapInstruction(
    {
      phoenixProgram: PROGRAM_ID,
      logAuthority: PublicKey.findProgramAddressSync(
        [Buffer.from("log")],
        PROGRAM_ID
      )[0],
      market: marketKey,
      trader: traderKeypair.publicKey,
      baseAccount: getAta(
        traderKeypair.publicKey,
        market.header.baseParams.mintKey
      ),
      quoteAccount: getAta(
        traderKeypair.publicKey,
        market.header.quoteParams.mintKey
      ),
      quoteVault: market.header.quoteParams.vaultKey,
      baseVault: market.header.baseParams.vaultKey,
    },
    { orderPacket: { __kind: "ImmediateOrCancel", ...ioc } }
  );

  let txId = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(ix),
    [traderKeypair],
    { skipPreflight: true, commitment: "confirmed" }
  );
  console.log(txId);

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
  let fillEvents = txResult.instructions[0];

  let summary = fillEvents.events[
    fillEvents.events.length - 1
  ] as FillSummaryEvent;

  if (ioc.side == Side.Bid) {
    console.log(
      "Filled",
      toNum(summary.totalBaseLotsFilled) / market.baseLotsPerBaseUnit,
      "SOL"
    );
  } else {
    console.log(
      "Sold 10 SOL for",
      (toNum(summary.totalQuoteLotsFilled) * market.header.quoteLotSize) /
        10 ** market.header.quoteParams.decimals,
      "USDC"
    );
  }
  let fees =
    (toNum(summary.totalFeeInQuoteLots) * market.header.quoteLotSize) /
    10 ** market.header.quoteParams.decimals;

  console.log(`Paid $${fees} in fees:`);
}

main()
  .then((_) => {
    console.log("Done");
  })
  .catch((err) => {
    console.log(err);
  });
