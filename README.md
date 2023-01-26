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
import { Connection, Keypair, Transaction } from "@solana/web3.js";
import * as Phoenix from "@ellipsis-labs/phoenix-sdk";

async function exampleSwap() {
  const connection = new Connection("https://api.devnet.solana.com/");
  const trader = new Keypair();

  // Creating a Phoenix client
  const phoenix = await Phoenix.Client.create(connection);
  const market = phoenix.markets.find((market) => market.name === "SOL/USDC");

  // Example of a simple swap
  const bidTx = market.getSwapTransaction({
    side: Phoenix.Side.Bid,
    inAmount: 1,
    trader: traderKeypair.publicKey,
  });
  const bidTxId = connection.sendTransaction(bidTx, [traderKeypair]);
  console.log("Swap (bid) sent: ", bidTxId);

  //////////////////////////////////////////////////////
  // Create a swap transaction from scratch ////////////
  //////////////////////////////////////////////////////
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
  )[0]

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

  const orderPacket = market.getSwapOrderPacket({
    side,
    inAmount
  });

  const expAmountOut = market.getExpectedOutAmount({
    side,
    inAmount,
  });
  console.log("Expected amount out: ", expAmountOut);

  const askIx = Phoenix.createSwapInstruction(orderAccounts, {
    orderPacket: {
      __kind: "ImmediateOrCancel",
      ...orderPacket,
    },
  });

  const askTx = new Transaction().add(askIx);
  const askTxId = connection.sendTransaction(askTx, [traderKeypair]);
  console.log("Swap (ask) sent: ", askTxId);
}
```

