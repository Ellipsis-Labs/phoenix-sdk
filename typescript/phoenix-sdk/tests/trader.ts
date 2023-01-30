import { Connection, PublicKey } from "@solana/web3.js";

import * as Phoenix from "../src";

export async function trader(pubkey: string) {
  const connection = new Connection("https://qn-devnet.solana.fm/");
  const traderKey = new PublicKey(pubkey);
  const phoenix = await Phoenix.Client.create(connection, traderKey);
  console.log(phoenix.trader.tokenBalances);
}

(async function () {
  try {
    await trader(process.argv[2]);
  } catch (err) {
    console.log("Error: ", err);
    process.exit(1);
  }

  process.exit(0);
})();
