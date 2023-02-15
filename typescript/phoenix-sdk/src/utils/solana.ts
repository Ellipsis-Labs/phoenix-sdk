export type Cluster = "mainnet-beta" | "devnet" | "localhost";

export function getClusterFromEndpoint(endpoint: string): Cluster {
  if (endpoint.includes("devnet")) return "devnet";
  if (endpoint.includes("local") || endpoint.includes("127.0.0.1"))
    return "localhost";

  return "mainnet-beta";
}
