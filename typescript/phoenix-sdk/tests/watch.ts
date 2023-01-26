import { Connection } from "@solana/web3.js";

import * as Phoenix from "../src";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function watch() {
  const connection = new Connection("https://qn-devnet.solana.fm/");
  const phoenix = await Phoenix.Client.create(connection);
  const market = phoenix.markets.find((market) => market.name === "SOL/USDC");
  if (!market) throw new Error("Market not found");

  let lastLadder = market.getUiLadder();
  while (true) {
    await sleep(1000);
    const ladder = market.getUiLadder();
    if (ladder !== lastLadder) {
      console.clear();
      market.printLadder();
      lastLadder = ladder;
    }
  }
}

watch();
