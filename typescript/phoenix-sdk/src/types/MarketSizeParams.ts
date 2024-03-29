/**
 * This code was GENERATED using the solita package.
 * Please DO NOT EDIT THIS FILE, instead rerun solita to update it or write a wrapper to add functionality.
 *
 * See: https://github.com/metaplex-foundation/solita
 */

import * as beet from "@metaplex-foundation/beet";
export type MarketSizeParams = {
  bidsSize: beet.bignum;
  asksSize: beet.bignum;
  numSeats: beet.bignum;
};

/**
 * @category userTypes
 * @category generated
 */
export const marketSizeParamsBeet = new beet.BeetArgsStruct<MarketSizeParams>(
  [
    ["bidsSize", beet.u64],
    ["asksSize", beet.u64],
    ["numSeats", beet.u64],
  ],
  "MarketSizeParams"
);
