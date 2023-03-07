import { Connection } from "@solana/web3.js";

import * as Phoenix from "../src";
import BN from "bn.js";
import { bignum } from "@metaplex-foundation/beet";
import { getUiOrderSequenceNumber } from "../src";

// Run with `ts-node examples/openOrders.ts`
// This example will find the first trader with locked orders and display them
// Change the RPC URL and cluster name to connect to a different cluster (e.g. devnet)

const displayOpenOrder = (
  order: Phoenix.RestingOrder,
  slot: bignum,
  time: bignum,
  side: string,
  orderSequenceNumber: string,
  price: number,
  size: number
) => {
  const timeRemaining =
    (order.lastValidSlot != 0 && order.lastValidSlot < slot) ||
    (order.lastValidUnixTimestampInSeconds != 0 &&
      order.lastValidUnixTimestampInSeconds < (time as BN))
      ? "∞"
      : (order.lastValidUnixTimestampInSeconds as BN)
          .sub(time as BN)
          .add(new BN(1))
          .toString();
  console.log(side, orderSequenceNumber, price, size, timeRemaining);
};

export async function watch() {
  const connection = new Connection("http://127.0.0.1:8899");
  const phoenix = await Phoenix.Client.create(connection, "localhost");

  const market = Array.from(phoenix.markets.values()).find(
    (market) => market.name === "SOL/USDC"
  );
  if (!market) throw new Error("Market not found");

  // Locate the first trader with locked orders
  let traderKey;
  for (const [trader, traderState] of market.data.traders) {
    if (traderState.baseLotsLocked != 0 || traderState.quoteLotsLocked != 0) {
      traderKey = trader;
      break;
    }
  }

  if (traderKey === undefined) {
    throw new Error("No locked orders found");
  }

  const marketAddress = market.address.toBase58();
  const traderIndex = market.data.traderPubkeyToTraderIndex.get(traderKey);
  if (traderIndex === undefined) {
    throw new Error(`Trader index not found for ${traderKey}`);
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    console.clear();
    console.log("Open Orders for trader: " + traderKey + "\n");
    const slot = phoenix.clock.slot;
    const time = phoenix.clock.unixTimestamp;
    for (const [orderId, order] of market.data.asks) {
      if (Phoenix.toNum(order.traderIndex) === traderIndex) {
        displayOpenOrder(
          order,
          slot,
          time,
          "ASK",
          getUiOrderSequenceNumber(orderId).toString(),
          phoenix.ticksToFloatPrice(
            Phoenix.toNum(orderId.priceInTicks),
            marketAddress.toString()
          ),
          phoenix.baseAtomsToRawBaseUnits(
            phoenix.baseLotsToBaseAtoms(
              Phoenix.toNum(order.numBaseLots),
              marketAddress.toString()
            ),
            marketAddress.toString()
          )
        );
      }
    }

    for (const [orderId, order] of market.data.bids) {
      if (Phoenix.toNum(order.traderIndex) === traderIndex) {
        displayOpenOrder(
          order,
          slot,
          time,
          "BID",
          getUiOrderSequenceNumber(orderId).toString(),
          phoenix.ticksToFloatPrice(
            Phoenix.toNum(orderId.priceInTicks),
            marketAddress.toString()
          ),
          phoenix.baseAtomsToRawBaseUnits(
            phoenix.baseLotsToBaseAtoms(
              Phoenix.toNum(order.numBaseLots),
              marketAddress.toString()
            ),
            marketAddress.toString()
          )
        );
      }
    }
    await phoenix.refreshMarket(marketAddress);
    await new Promise((res) => setTimeout(res, 500));
  }
}

(async function () {
  try {
    await watch();
  } catch (err) {
    console.log("Error: ", err);
    process.exit(1);
  }

  process.exit(0);
})();
