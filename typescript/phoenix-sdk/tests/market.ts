import { Connection, PublicKey } from "@solana/web3.js";

import * as Phoenix from "../src";

// Ex: ts-node tests/market.ts
export async function market() {

  const connection = new Connection("https://api.mainnet-beta.solana.com");
  const phoenix = await Phoenix.Client.create(connection, "mainnet");
  let m = phoenix.markets.find((market) => market.name === "SOL/USDC");
  let index = m?.data.trader_index; 
  console.log(index);
}

(async function () {
  try {
    await market();
  } catch (err) {
    console.log("Error: ", err);
    process.exit(1);
  }

  process.exit(0);
})();
