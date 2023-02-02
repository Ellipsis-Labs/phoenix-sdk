import * as beet from "@metaplex-foundation/beet";
import BN from "bn.js";

/**
 * Converts a beet.bignum to a number.
 *
 * @param n The number to convert
 */
export function toNum(n: beet.bignum) {
  let target: number;
  if (typeof n === "number") {
    target = n;
  } else {
    target = n.toNumber();
  }
  return target;
}

/**
 * Converts a number to a BN.
 *
 * @param n The number to convert
 */
export function toBN(n: number | beet.bignum) {
  if (typeof n === "number") {
    return new BN(n);
  } else {
    return n.clone();
  }
}

/**
 * Converts a BN sort value to a number.
 *
 * Required because sort function must return a number.
 *
 * @param n The BN to convert
 */
export function sign(n: BN) {
  if (n.lt(new BN(0))) {
    return -1;
  } else if (n.gt(new BN(0))) {
    return 1;
  } else {
    return 0;
  }
}
