import { Connection } from "@solana/web3.js";

import * as Phoenix from "../src";

// Ex: ts-node examples/deserializeClock.ts
export async function decodeTransaction() {
  const connection = new Connection("https://api.mainnet-beta.solana.com");
  console.log(
    JSON.stringify(
      (
        await Phoenix.getEventsFromTransaction(
          connection,
          "5uWatP9Dpsq7BjgUZ83kqhVnRWD3PKZrTH1KYYB7gdu22QXSKP3FBCZ3PcuzecFhxqRnp6aociU5x5RuNAP4F1mh"
        )
      ).instructions,
      null,
      "  "
    )
  );
}

(async function () {
  try {
    await decodeTransaction();
  } catch (err) {
    console.log("Error: ", err);
    process.exit(1);
  }

  process.exit(0);
})();
