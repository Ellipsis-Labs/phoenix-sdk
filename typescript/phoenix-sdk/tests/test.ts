import { Connection, PublicKey } from "@solana/web3.js";
import { deserializeMarket } from "../src/market";
import { getEventsFromTransaction } from "../src/events";

async function main() {
  let connection = new Connection("https://qn-devnet.solana.fm/", "confirmed");
  let marketKey = new PublicKey("5iLqmcg8vifdnnw6wEpVtQxFE4Few5uiceDWzi3jvzH8");

  let marketAccount = await connection.getAccountInfo(marketKey, "confirmed");
  let market = deserializeMarket(marketAccount!.data);

  console.log(market);
  console.log(market.getLadder(5));
  let events = await getEventsFromTransaction(
    connection,
    "455HXmYu2W96qkihAYqrqs7namgy5ajGWZe8HYMENyfxjc4bTHPeGNsxkQdUiUwBsox1VnCKifiF5LXTjMcyRWuJ"
  );
  console.log(events.instructions[0]);
}

main()
  .then((_) => {
    console.log("Done");
  })
  .catch((err) => {
    console.log(err);
  });
