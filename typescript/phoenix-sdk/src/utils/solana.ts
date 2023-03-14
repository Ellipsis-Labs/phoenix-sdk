import * as beet from "@metaplex-foundation/beet";

export type Cluster = "mainnet-beta" | "devnet" | "localhost";

export function getClusterFromEndpoint(endpoint: string): Cluster {
  if (endpoint.includes("dev")) return "devnet";
  if (endpoint.includes("local") || endpoint.includes("127.0.0.1"))
    return "localhost";

  return "mainnet-beta";
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
