import { Connection } from "@solana/web3.js";

import * as Phoenix from "../src";

// Ex: ts-node tests/printTraderIndices.ts
export async function printTraderIndices() {
  const connection = new Connection("https://api.mainnet-beta.solana.com");
  const phoenix = await Phoenix.Client.create(connection, "mainnet");
  for (const [marketAddress, market] of phoenix.markets) {
    if (market.name === "SOL/USDC") {
      console.log("SOL/USDC marketAddress: ", marketAddress);
      const traderPubkeyToTraderIndex = market.data.traderPubkeyToTraderIndex;
      console.log(traderPubkeyToTraderIndex);
      break;
    }
  }
}

(async function () {
  try {
    await printTraderIndices();
  } catch (err) {
    console.log("Error: ", err);
    process.exit(1);
  }

  process.exit(0);
})();
