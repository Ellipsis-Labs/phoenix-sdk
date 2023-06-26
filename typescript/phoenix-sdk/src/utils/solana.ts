import * as beet from "@metaplex-foundation/beet";
import { Connection } from "@solana/web3.js";

export type Cluster = "mainnet-beta" | "devnet" | "localhost";

export async function getClusterFromConnection(
  connection: Connection
): Promise<Cluster> {
  const hash = await connection.getGenesisHash();
  if (hash === "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d") {
    return "mainnet-beta";
  } else if (hash === "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG") {
    return "devnet";
  } else {
    return "localhost";
  }
}

export function deserializeClockData(data: Buffer): ClockData {
  const [clockData] = clockBeet.deserialize(data, 0);
  return clockData;
}

export type ClockData = {
  slot: beet.bignum;
  epochStartTime: beet.bignum;
  epoch: beet.bignum;
  leaderScheduleEpoch: beet.bignum;
  unixTimestamp: beet.bignum;
};

export const clockBeet = new beet.BeetArgsStruct<ClockData>(
  [
    ["slot", beet.u64],
    ["epochStartTime", beet.i64],
    ["epoch", beet.u64],
    ["leaderScheduleEpoch", beet.u64],
    ["unixTimestamp", beet.i64],
  ],
  "ClockData"
);
