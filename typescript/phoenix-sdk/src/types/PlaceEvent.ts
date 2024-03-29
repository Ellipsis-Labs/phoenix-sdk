/**
 * This code was GENERATED using the solita package.
 * Please DO NOT EDIT THIS FILE, instead rerun solita to update it or write a wrapper to add functionality.
 *
 * See: https://github.com/metaplex-foundation/solita
 */

import * as beet from "@metaplex-foundation/beet";
export type PlaceEvent = {
  index: number;
  orderSequenceNumber: beet.bignum;
  clientOrderId: beet.bignum;
  priceInTicks: beet.bignum;
  baseLotsPlaced: beet.bignum;
};

/**
 * @category userTypes
 * @category generated
 */
export const placeEventBeet = new beet.BeetArgsStruct<PlaceEvent>(
  [
    ["index", beet.u16],
    ["orderSequenceNumber", beet.u64],
    ["clientOrderId", beet.u128],
    ["priceInTicks", beet.u64],
    ["baseLotsPlaced", beet.u64],
  ],
  "PlaceEvent"
);
