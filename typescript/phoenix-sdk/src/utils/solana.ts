export type Cluster = "mainnet-beta" | "devnet" | "localhost";

export function getClusterFromEndpoint(endpoint: string): Cluster {
  if (endpoint.includes("dev")) return "devnet";
  if (endpoint.includes("local") || endpoint.includes("127.0.0.1"))
    return "localhost";

  return "mainnet-beta";
}

export interface iClock {
  slot: bigint;
  epochStartTime: bigint;
  epoch: bigint;
  leaderScheduleEpoch: bigint;
  unixTimestamp: bigint;
}
export class Clock {
  slot: bigint;
  epochStartTime: bigint;
  epoch: bigint;
  leaderScheduleEpoch: bigint;
  unixTimestamp: bigint;

  constuctor(fields: iClock) {
    Object.assign(this, fields);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ClockSchema = new Map<any, any>([
  [
    Clock,
    {
      kind: "struct",
      fields: [
        ["slot", "u64"],
        ["epochStartTime", "u64"],
        ["epoch", "u64"],
        ["leaderScheduleEpoch", "u64"],
        ["unixTimestamp", "u64"],
      ],
    },
  ],
]);
