import { Connection } from "@solana/web3.js";
import { BN } from "bn.js";

import * as Phoenix from "../src";

// Ex: ts-node examples/deserializeClock.ts
export async function deserializeClock() {
  const connection = new Connection("https://api.mainnet-beta.solana.com");
  const phoenix = await Phoenix.Client.create(connection, "mainnet");
  const clock = phoenix.clock;
  console.log("slot:", new BN(clock.slot).toNumber());
  console.log("epoch start time:", new BN(clock.epochStartTime).toNumber());
  console.log("epoch:", new BN(clock.epoch).toNumber());
  console.log(
    "leader schedule epoch:",
    new BN(clock.leaderScheduleEpoch).toNumber()
  );
  console.log("unix timestamp:", new BN(clock.unixTimestamp).toNumber());
}

(async function () {
  try {
    await deserializeClock();
  } catch (err) {
    console.log("Error: ", err);
    process.exit(1);
  }

  process.exit(0);
})();
