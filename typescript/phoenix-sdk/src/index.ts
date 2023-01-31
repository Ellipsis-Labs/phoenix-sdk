import { PublicKey } from "@solana/web3.js";

export * from "./errors";
export * from "./events";
export * from "./types";
export * from "./utils";
export * from "./instructions";
export * from "./token";
export * from "./market";
export * from "./trader";
export * from "./client";

/**
 * Program address
 *
 * @category constants
 * @category generated
 */
export const PROGRAM_ADDRESS = "phnxNHfGNVjpVVuHkceK3MgwZ1bW25ijfWACKhVFbBH";

/**
 * Program public key
 *
 * @category constants
 * @category generated
 */
export const PROGRAM_ID = new PublicKey(PROGRAM_ADDRESS);
