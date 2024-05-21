import { Connection } from "@solana/web3.js";

import * as Phoenix from "../src";

// Ex: ts-node examples/printTraderStates.ts
export async function printTraderStates() {
  const connection = new Connection("https://api.mainnet-beta.solana.com");
  const phoenix = await Phoenix.Client.create(connection);
  for (const [marketAddress, market] of phoenix.marketConfigs) {
    if (market.name === "SOL/USDC") {
      console.log("SOL/USDC marketAddress: ", marketAddress);
      const marketState = phoenix.marketStates.get(marketAddress);
      if (!marketState) {
        continue;
      }
      for (const [traderPubkey, traderState] of marketState.data.traders) {
        console.log("Trader pubkey: ", traderPubkey);
        console.log(
          "Quote lots locked:",
          traderState.quoteLotsLocked.toString()
        );
        console.log(
          "Base lots locked: ",
          traderState.baseLotsLocked.toString()
        );
        console.log("Quote lots free:  ", traderState.quoteLotsFree.toString());
        console.log("Base lots free:   ", traderState.baseLotsFree.toString());
      }
      break;
    }
  }
}

(async function () {
  try {
    await printTraderStates();
  } catch (err) {
    console.log("Error: ", err);
    process.exit(1);
  }

  process.exit(0);
})();
