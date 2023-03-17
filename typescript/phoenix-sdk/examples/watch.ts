import { Connection } from "@solana/web3.js";

import * as Phoenix from "../src";

// Run with `ts-node examples/watch.ts`
// This example will print the order book every time it changes

export async function watch() {
  const connection = new Connection("http://127.0.0.1:8899");
  const phoenix = await Phoenix.Client.create(connection, "localhost");

  console.log(phoenix.markets);
  const market = Array.from(phoenix.markets.values()).find(
    (market) => market.name === "SOL/USDC"
  );
  if (!market) throw new Error("Market not found");

  const marketAddress = market.address.toBase58();

  let lastLadder: Phoenix.UiLadder | null = null;
  let updates = 0;
  while (updates < 10) {
    const ladder = phoenix.getUiLadder(marketAddress);
    if (JSON.stringify(ladder) !== JSON.stringify(lastLadder)) {
      console.clear();
      console.log("Ladder update", updates + 1, "of", 10, "\n");
      phoenix.printLadder(marketAddress);
      lastLadder = ladder;
      updates++;
    }

    await phoenix.refreshMarket(marketAddress);
    await new Promise((res) => setTimeout(res, 500));
  }
}

(async function () {
  try {
    await watch();
  } catch (err) {
    console.log("Error: ", err);
    process.exit(1);
  }

  process.exit(0);
})();
