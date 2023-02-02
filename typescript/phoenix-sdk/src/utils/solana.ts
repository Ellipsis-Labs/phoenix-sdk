export enum Cluster {
  MainnetBeta = "mainnet-beta",
  Devnet = "devnet",
  Localhost = "localhost",
}

export function clusterFromEndpoint(endpoint: string): Cluster {
  if (endpoint.includes("devnet")) return Cluster.Devnet;
  if (endpoint.includes("local") || endpoint.includes("127.0.0.1"))
    return Cluster.Localhost;
  return Cluster.MainnetBeta;
}
