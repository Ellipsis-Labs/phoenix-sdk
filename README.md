# Phoenix SDK

An SDK for interacting with the Phoenix program.

\*_We currently support Rust and TypeScript, with Python on the way._

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

import * as Phoenix from "@ellipsis-labs/phoenix-sdk";

async function simpleSwap() {
  const connection = new Connection("https://api.devnet.solana.com/");
  // DO NOT USE THIS KEYPAIR IN PRODUCTION
  const trader = Keypair.fromSecretKey(
    base58.decode(
      "2PKwbVQ1YMFEexCmUDyxy8cuwb69VWcvoeodZCLegqof84DJSTiEd89Ak3so9CiHycZwynesTt1JUDFAPFWEzvVs"
    )
  );

  // Create a Phoenix client and select a market
  const phoenix = await Phoenix.Client.create(connection);
  const marketConfig = phoenix.marketConfigs.find((market) => market.name === "SOL/USDC");
  if (!marketConfig) {
    throw new Error("Market config not found");
  }
  const marketState = phoenix.marketStates.get(marketConfig.marketId);
  if (!marketState) {
    throw new Error("Market state not found");
  }

  // Submit a market order buying 100 USDC worth of SOL
  const tx = marketState.getSwapTransaction({
    side: Phoenix.Side.Bid,
    inAmount: 100,
    trader: trader.publicKey,
  });

  const txId = await connection.sendTransaction(tx, [trader]);
  console.log("Transaction ID: ", txId);
}
```
