#Phoenix SDK

An SDK for interacting with the Phoenix program.

**We currently support Rust and TypeScript, with Python on the way.*

## Rust

To run the sample Rust code, run:

```sh
$ cd rust
$ cargo run --bin sample -- -r $YOUR_DEVNET_RPC_ENDPOINT
```

## TypeScript

```TypeScript
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import base58 from "bs58";

import * as Phoenix from "../src";

async function swap() {
  const connection = new Connection("https://api.devnet.solana.com/");
  // DO NOT USE THIS KEYPAIR IN PRODUCTION
  const trader = Keypair.fromSecretKey(
    base58.decode(
      "2PKwbVQ1YMFEexCmUDyxy8cuwb69VWcvoeodZCLegqof84DJSTiEd89Ak3so9CiHycZwynesTt1JUDFAPFWEzvVs"
    )
  );

  // Creat a Phoenix client
  const phoenix = await Phoenix.Client.create(connection);

  // Grab a market
  const market = phoenix.markets.find((market) => market.name === "SOL/USDC");
  if (!market) throw new Error("Market not found");

  // Submit a simple swap order
  console.log("Swap #1");
  const bidTx = market.getSwapTransaction({
    side: Phoenix.Side.Bid,
    inAmount: 100,
    trader: trader.publicKey,
  });
  const bidTxId = await connection.sendTransaction(bidTx, [trader]);
  console.log("Transaction ID: ", bidTxId, "\n");

  // Create and send a swap transaction from scratch
  console.log("Swap #2");
  const baseAccount = PublicKey.findProgramAddressSync(
    [
      trader.publicKey.toBuffer(),
      TOKEN_PROGRAM_ID.toBuffer(),
      market.baseToken.data.mintKey.toBuffer(),
    ],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];
  const quoteAccount = PublicKey.findProgramAddressSync(
    [
      trader.publicKey.toBuffer(),
      TOKEN_PROGRAM_ID.toBuffer(),
      market.quoteToken.data.mintKey.toBuffer(),
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
    market: market.address,
    trader: trader.publicKey,
    baseAccount,
    quoteAccount,
    quoteVault: market.data.header.quoteParams.vaultKey,
    baseVault: market.data.header.baseParams.vaultKey,
  };

  const side = Phoenix.Side.Ask;
  const inAmount = 1;

  const expAmountOut = market.getExpectedOutAmount({
    side,
    inAmount,
  });
  console.log("Expected amount out: ", expAmountOut);

  const orderPacket = market.getSwapOrderPacket({
    side,
    inAmount,
    slippage: Phoenix.DEFAULT_SLIPPAGE_PERCENT,
    selfTradeBehavior: Phoenix.SelfTradeBehavior.Abort,
    matchLimit: Phoenix.DEFAULT_MATCH_LIMIT,
    clientOrderId: 0,
    useOnlyDepositedFunds: false,
  });

  const askIx = Phoenix.createSwapInstruction(orderAccounts, {
    orderPacket: {
      __kind: "ImmediateOrCancel",
      ...orderPacket,
    },
  });

  const askTx = new Transaction().add(askIx);
  const askTxId = await connection.sendTransaction(askTx, [trader]);
  console.log("Transaction ID: ", askTxId);

  let txResult = await Phoenix.getEventsFromTransaction(connection, askTxId);
  while (txResult.instructions.length == 0) {
    txResult = await Phoenix.getEventsFromTransaction(connection, askTxId);
  }
  const fillEvents = txResult.instructions[0];
  const summary = fillEvents.events[
    fillEvents.events.length - 1
  ] as Phoenix.FillSummaryEvent;
  console.log(
    "Sold",
    inAmount,
    "SOL for",
    (Phoenix.toNum(summary.totalQuoteLotsFilled) *
      Phoenix.toNum(market.data.header.quoteLotSize)) /
      10 ** market.data.header.quoteParams.decimals,
    "USDC"
  );

  const fees =
    (Phoenix.toNum(summary.totalFeeInQuoteLots) *
      Phoenix.toNum(market.data.header.quoteLotSize)) /
    10 ** market.data.header.quoteParams.decimals;
  console.log(`Paid $${fees} in fees`);
}
```

