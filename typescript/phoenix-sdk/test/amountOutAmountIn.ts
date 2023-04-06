import { assert } from "chai";
import { UiLadder } from "../src/market";
import { Side } from "../src/types";
import { getExpectedInAmountRouter } from "index";

const mockLadder: UiLadder = {
  bids: [
    [20, 10],
    [15, 5],
    [10, 2],
  ],
  asks: [
    [25, 10],
    [30, 5],
    [35, 2],
  ],
};

describe("Calculate expected amount out correctly for both bid and ask", () => {
  it("Correctly calculate expected amount in given a desired amount out", () => {
    // Test case where a user wants to receive 16 units of the base token and wants to know how many quote units they need to provide.
    let side = Side.Bid;
    const desiredBaseAmountOut = 16;
    const takerFeeBps = 5;
    const expectedQuoteAmountIn = getExpectedInAmountRouter({
      uiLadder: mockLadder,
      takerFeeBps,
      side,
      outAmount: desiredBaseAmountOut,
    });
    const quoteUnitsNeeded =
      (25 * 10 + 30 * 5 + 35 * 1) / (1 - takerFeeBps / 10000);
    assert.equal(expectedQuoteAmountIn, quoteUnitsNeeded);
    // Test case where user wants to receive 285 units of quote token and wants to know how many base units they need to provide.
    side = Side.Ask;
    const desiredQuoteAmountOut = 20 * 10 + 15 * 5 + 10;
    const expectedBaseAmountIn = getExpectedInAmountRouter({
      uiLadder: mockLadder,
      takerFeeBps,
      side,
      outAmount: desiredQuoteAmountOut,
    });
    const baseUnitsNeeded = (10 + 5 + 1) / (1 - takerFeeBps / 10000);
    assert.equal(expectedBaseAmountIn, baseUnitsNeeded);
  });
});
