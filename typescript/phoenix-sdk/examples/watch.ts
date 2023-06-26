import { Connection } from "@solana/web3.js";

import * as Phoenix from "../src";

// Run with `ts-node examples/watch.ts`
// This example will print the order book every time it changes

export async function watch() {
  const connection = new Connection("https://api.mainnet-beta.solana.com");
  const phoenix = await Phoenix.Client.create(connection);

  console.log(phoenix.marketConfigs);
  console.log(phoenix.marketStates);
  const marketConfig = Array.from(phoenix.marketConfigs.values()).find(
    (market) => market.name === "SOL/USDC"
  );

  if (!marketConfig) throw new Error("Market not found");

  const marketAddress = marketConfig.marketId;

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
