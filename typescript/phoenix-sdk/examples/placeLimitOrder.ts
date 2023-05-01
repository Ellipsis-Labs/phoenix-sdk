import {
  Connection,
  PublicKey,
  Transaction,
  Keypair,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { airdropSplTokensForMarketIxs } from "../src/utils/genericTokenMint";

import * as PhoenixSdk from "../src";

// This script sets up a trader as a maker on a phoenix market and sends a limit order on behalf of the trader.
// You can execute this Typescript script by using ts-node, the Typescript execution and REPL package for node.js. Installation and details: https://www.npmjs.com/package/ts-node
// Example: At the root Phoenix SDK directory, run `ts-node typescript/phoenix-sdk/examples/placeLimitOrder.ts`
export async function placeLimitOrderExample() {
  const endpoint = "https://api.devnet.solana.com";
  const connection = new Connection(endpoint);

  // Use your keypair in the place of the below traderKeypair example to instantiate the Client.
  const traderKeypair = new Keypair();
  console.log("Trader pubkey: ", traderKeypair.publicKey.toBase58());
  const phoenixClient = await PhoenixSdk.Client.create(
    connection,
    endpoint,
    traderKeypair.publicKey
  );

  // Request a SOL airdrop to send the transaction in this example. Only needed, and will only work, on devnet.
  // This method has a high rate of failure. Use your own devnet RPC endpoint for more consistent results.
  await phoenixClient.connection.requestAirdrop(
    traderKeypair.publicKey,
    1_000_000_000
  );

  // This is a market for SOL/USDC on devnet.
  const marketAddress = new PublicKey(
    "CS2H8nbAVVEUHWPF5extCSymqheQdkd4d7thik6eet9N"
  );
  const market = phoenixClient.markets.get(marketAddress.toBase58());
  if (market === undefined) {
    throw Error("Market not found");
  }
  const marketData = market.data;

  // If you are a new maker, you will need to create associated token accounts for the base and quote tokens, and claim a maker seat on the market.
  // This function creates a bundle of new instructions that includes:
  // - Create associated token accounts for base and quote tokens, if needed
  // - Claim a maker seat on the market, if needed
  const setupNewMakerIxs = await PhoenixSdk.getMakerSetupInstructionsForMarket(
    connection,
    market,
    traderKeypair.publicKey
  );
  const setupTx = new Transaction().add(...setupNewMakerIxs);

  const setupTxId = await sendAndConfirmTransaction(
    connection,
    setupTx,
    [traderKeypair],
    {
      skipPreflight: true,
      commitment: "confirmed",
    }
  );
  console.log(
    `Setup Tx Link: https://beta.solscan.io/tx/${setupTxId}?cluster=devnet`
  );

  // To place a limit order, you will need base and quote tokens. For this devnet example, we mint the base and quote tokens from a token facuet.
  // To trade on mainnet, you will need to have base and quote tokens for the given market.
  const airdropSplIxs = await airdropSplTokensForMarketIxs(
    phoenixClient,
    marketData,
    traderKeypair.publicKey
  );
  const airdropSplTx = new Transaction().add(...airdropSplIxs);

  const airdropTxId = await sendAndConfirmTransaction(
    connection,
    airdropSplTx,
    [traderKeypair],
    {
      skipPreflight: true,
      commitment: "confirmed",
    }
  );
  console.log(
    `Airdrop Tx Link: https://beta.solscan.io/tx/${airdropTxId}?cluster=devnet`
  );

  // Once you have tokens and a maker seat on the market, you can place any number of limit orders by sending the limit order instruction, created with the limit order packet.
  for (let i = 0; i < 5; i++) {
    const limitOrderPacket = PhoenixSdk.getLimitOrderPacket({
      side: PhoenixSdk.Side.Bid,
      priceInTicks: 200,
      numBaseLots: 1,
    });

    // Create a limit order instruction
    const limitOrderIx = phoenixClient.createPlaceLimitOrderInstruction(
      limitOrderPacket,
      marketAddress.toBase58(),
      traderKeypair.publicKey
    );

    const tx = new Transaction().add(limitOrderIx);

    const txId = await sendAndConfirmTransaction(
      connection,
      tx,
      [traderKeypair],
      {
        skipPreflight: true,
        commitment: "confirmed",
      }
    );

    // Note: Your order may fail if you no longer have a seat on the market, which can happen if the market's trader state is full and you did not have open orders.
    // In that case, you can generate the instructions to create a seat with confirmOrCreateClaimSeatIxs or with getMakerSetupInstructionsForMarket as used the above.
    console.log(
      `Order ${
        i + 1
      } Tx Link: https://beta.solscan.io/tx/${txId}?cluster=devnet`
    );
  }
}

(async function () {
  try {
    await placeLimitOrderExample();
  } catch (err) {
    console.log("Error: ", err);
    process.exit(1);
  }

  process.exit(0);
})();
