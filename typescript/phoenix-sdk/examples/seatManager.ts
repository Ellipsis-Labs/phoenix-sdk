import {
  Connection,
  PublicKey,
  Transaction,
  Keypair,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  getSeatManagerAddress,
  deserializeSeatManagerData,
  getClaimSeatIx,
  getEvictSeatIx,
} from "../src/utils/seatManager";
import * as assert from "assert";

import * as Phoenix from "../src";

const devnetSeatManagerAuthority = new PublicKey(
  "AJbjEM3LCmFZq57fKg9Cmz4RaXyZn48H6T5KBwRsvF81"
);

// This script contains actions that you can perform on a Phoenix Seat account.
// The main actions are: (i) claim seat, (ii) evict seat, (iii) and get a market's Seat Manager data, each contained in example functions below.
// You can execute this Typescript script by using ts-node, the Typescript execution and REPL package for node.js. Installation and details: https://www.npmjs.com/package/ts-node
// Example: At the root Phoenix SDK directory, run `ts-node typescript/phoenix-sdk/examples/seatManager.ts`

// Get the seat manager data for a given market.
// Useful if you want to know the seat manager authority, the seat manager successor, the number of makers on the market, or designated market makers, if any.
export async function getSeatManager() {
  const endpoint = "https://api.devnet.solana.com";
  const connection = new Connection(endpoint);
  const phoenix = await Phoenix.Client.create(connection, endpoint);

  // This is a SOL / USDC market on devnet.
  const marketAddress = new PublicKey(
    "CS2H8nbAVVEUHWPF5extCSymqheQdkd4d7thik6eet9N"
  );

  const seatManagerAddress = getSeatManagerAddress(marketAddress);
  const seatManagerAccountInfo = await phoenix.connection.getAccountInfo(
    seatManagerAddress
  );
  if (!seatManagerAccountInfo)
    throw new Error(
      "Seat Manager Account not found for market: " + marketAddress?.toBase58()
    );

  // Deserialize the data inside the Seat Manager Account
  const seatManagerObject = deserializeSeatManagerData(
    Buffer.from(seatManagerAccountInfo.data)
  );

  // For the purposes of this example, assert that the authority for the above market is the same as the devnetSeatManagerAuthority.
  // You can remove or replace the below logic with the conditions you want to verify.
  assert.equal(
    seatManagerObject.authority.toBase58(),
    devnetSeatManagerAuthority.toBase58()
  );
  assert.equal(seatManagerObject.market.toBase58(), marketAddress.toBase58());
  console.log("Seat Manager Market: ", seatManagerObject.market.toBase58());
  console.log(
    "Seat Manager Authority: ",
    seatManagerObject.authority.toBase58()
  );
}

// You need to claim a seat on a Phoenix market before you can place limit orders.
// This example shows how to claim a seat on a given market.
// If you are new to a market and want to place a limit order,
// please see the `getMakerSetupInstructionsForMarket` function and the `placeLimitOrder.ts` in the examples directory, which contains additional logic to place limit orders.
export async function claimSeat() {
  const endpoint = "https://api.devnet.solana.com";
  const connection = new Connection(endpoint);

  // Use your keypair in the place of the below traderKeypair example to instantiate the Client.
  const traderKeypair = new Keypair();
  const phoenix = await Phoenix.Client.create(
    connection,
    endpoint,
    traderKeypair.publicKey
  );
  console.log("Trader pubkey: ", traderKeypair.publicKey.toBase58());
  // Request a SOL airdrop to send the transaction in this example. Only needed, and will only work, on devnet.
  await phoenix.connection.requestAirdrop(
    traderKeypair.publicKey,
    1_000_000_000
  );

  // This is a SOL / USDC market on devnet.
  const marketAddress = new PublicKey(
    "CS2H8nbAVVEUHWPF5extCSymqheQdkd4d7thik6eet9N"
  );

  // Create a claim seat instruction, attach to a Transaction, and send.
  const claimSeatIx = getClaimSeatIx(marketAddress, traderKeypair.publicKey);
  const tx = new Transaction().add(claimSeatIx);
  const txId = await sendAndConfirmTransaction(
    connection,
    tx,
    [traderKeypair],
    {
      skipPreflight: true,
      commitment: "confirmed",
    }
  );
  console.log(
    `Claim seat tx Link: https://beta.solscan.io/tx/${txId}?cluster=devnet`
  );

  // This refreshes the market state from the blockchain, so we can check that claiming the seat succeeded.
  await phoenix.refreshMarket(marketAddress);
  const marketData = phoenix.markets.get(marketAddress.toBase58())?.data;
  const traderIndex = marketData?.traderPubkeyToTraderIndex.get(
    traderKeypair.publicKey.toBase58()
  );
  assert.ok(traderIndex !== undefined);
}

// Evict a trader from the market state. You may need to evict a trader if the market trader state is at capacity.
// Notes:
// - Eviction only works when the market trader state is at capacity.
// - Eviction only works for a given trader when that trader does not have any locked base or quote tokens.
// - In most cases, you do not need to explicitly call evict seat. You can use the instruction creator function `confirmOrCreateClaimSeatIxs`, which will create an evict seat instruction for you, if needed.
// - If you wish to manually evict a trader and are unsure of which trader can be evicted, you can use the `findTraderToEvict` helper function.
export async function evictSeat() {
  const endpoint = "https://api.devnet.solana.com";
  const connection = new Connection(endpoint);

  // Use your keypair in the place of the below signerKeypair example to instantiate the Client.
  const signerKeypair = new Keypair();
  const phoenix = await Phoenix.Client.create(
    connection,
    endpoint,
    signerKeypair.publicKey
  );
  console.log("Signer pubkey: ", signerKeypair.publicKey.toBase58());
  // Request a SOL airdrop to send the transaction in this example. Only needed, and will only work, on devnet.
  await phoenix.connection.requestAirdrop(
    signerKeypair.publicKey,
    1_000_000_000
  );

  // This is a SOL / USDC market on devnet.
  const marketAddress = new PublicKey(
    "CS2H8nbAVVEUHWPF5extCSymqheQdkd4d7thik6eet9N"
  );

  // Here, we simulate a trader to evict.
  const traderKeypair = new Keypair();
  const market = phoenix.markets.get(marketAddress.toBase58());
  if (!market)
    throw new Error("Market not found: " + marketAddress?.toBase58());

  const evictSeatIx = getEvictSeatIx(
    market,
    traderKeypair.publicKey,
    signerKeypair.publicKey
  );

  const tx = new Transaction().add(evictSeatIx);
  const txId = await sendAndConfirmTransaction(
    connection,
    tx,
    [signerKeypair],
    {
      skipPreflight: true,
      commitment: "confirmed",
    }
  );
  console.log(
    `Evict seat tx Link: https://beta.solscan.io/tx/${txId}?cluster=devnet`
  );
}

(async function () {
  try {
    await getSeatManager();
    await claimSeat();
    await evictSeat();
  } catch (err) {
    console.log("Error: ", err);
    process.exit(1);
  }

  process.exit(0);
})();
