import { assert } from "chai";
import { UiLadder } from "../src/market";
import { Side } from "../src/types";
import {
  getRequiredInAmountRouter,
  getExpectedOutAmountRouter,
} from "../src/utils/market";

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

describe("Calculate expected amount out and expected amount in for both bid and ask", () => {
  it("Bid: Correctly calculate expected amount out given an amount in and an expected amount in given an amount out", () => {
    const side = Side.Bid;
    const quoteAmountIn = 25 * 10 + 30 * 5 + 35 * 1;
    const takerFeeBps = 5;
    const expectedBaseAmountOut = getExpectedOutAmountRouter({
      uiLadder: mockLadder,
      takerFeeBps,
      side,
      inAmount: quoteAmountIn,
    });
    const expectedQuoteAmountIn = getRequiredInAmountRouter({
      uiLadder: mockLadder,
      takerFeeBps,
      side,
      outAmount: expectedBaseAmountOut,
    });
    assert.equal(quoteAmountIn, expectedQuoteAmountIn);
  });

  it("Ask: Correctly calculate expected amount out given an amount in and an expected amount in given an amount out", () => {
    const side = Side.Ask;
    const baseAmountIn = 10 + 5 + 1;
    const takerFeeBps = 5;
    const expectedQuoteAmountOut = getExpectedOutAmountRouter({
      uiLadder: mockLadder,
      takerFeeBps,
      side,
      inAmount: baseAmountIn,
    });
    const expectedBaseAmountIn = getRequiredInAmountRouter({
      uiLadder: mockLadder,
      takerFeeBps,
      side,
      outAmount: expectedQuoteAmountOut,
    });
    assert.equal(baseAmountIn, expectedBaseAmountIn);
  });
});
