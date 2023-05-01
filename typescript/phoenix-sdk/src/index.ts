import { PublicKey } from "@solana/web3.js";

export * from "./errors";
export * from "./types";
export * from "./utils";
export * from "./instructions";
export * from "./token";
export * from "./events";
export * from "./market";
export * from "./trader";
export * from "./client";
export * from "./orderPacket";

/**
 * Program address
 *
 * @category constants
 * @category generated
 */
export const PROGRAM_ADDRESS = "PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY";

/**
 * Program public key
 *
 * @category constants
 * @category generated
 */
export const PROGRAM_ID = new PublicKey(PROGRAM_ADDRESS);

/**
 * Returns the Phoenix log authority Pubkey
 */
export function getLogAuthority(): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("log")], PROGRAM_ID)[0];
}
