import { Connection } from "@solana/web3.js";

import * as Phoenix from "../src";

export async function watch() {
  const connection = new Connection("https://qn-devnet.solana.fm/");
  const phoenix = await Phoenix.Client.create(connection);

  const market = phoenix.markets.find((market) => market.name === "wSOL/USDC");
  if (!market) throw new Error("Market not found");

  let lastLadder: Phoenix.UiLadder | null = null;
  let updates = 0;
  while (updates < 10) {
    const ladder = market.getUiLadder();
    if (JSON.stringify(ladder) !== JSON.stringify(lastLadder)) {
      console.clear();
      console.log("Ladder update", updates + 1, "of", 10, "\n");
      market.printLadder();
      lastLadder = ladder;
      updates++;
    }

    await market.refresh(connection);
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
