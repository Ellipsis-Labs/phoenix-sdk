import { PublicKey } from "@solana/web3.js";
export * from "./errors";
export * from "./instructions";
export * from "./types";
export * from "./market";
// export * from "./events"; issue with something assigned as bignum while not really being one

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
