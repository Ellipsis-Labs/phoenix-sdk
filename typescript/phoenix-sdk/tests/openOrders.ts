import { Connection } from "@solana/web3.js";

import * as Phoenix from "../src";
import BN from "bn.js";

const getOrderSequenceNumber = (orderId: Phoenix.OrderId): BN => {
  return (orderId.orderSequenceNumber as BN).fromTwos(64);
};

export async function watch() {
  const connection = new Connection("http://127.0.0.1:8899");
  const phoenix = await Phoenix.Client.create(connection, "localhost");

  const market = Array.from(phoenix.markets.values()).find(
    (market) => market.name === "SOL/USDC"
  );
  if (!market) throw new Error("Market not found");

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
  const traderIndex = market.data.traderIndex.get(traderKey);
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
        let timeRemaining = "∞";
        if (order.lastValidSlot != 0) {
          if (order.lastValidSlot < slot) {
            continue;
          }
        }
        if (order.lastValidUnixTimestampInSeconds != 0) {
          if (order.lastValidUnixTimestampInSeconds < (time as BN)) {
            continue;
          }
          timeRemaining = (order.lastValidUnixTimestampInSeconds as BN)
            .sub(time as BN)
            .add(new BN(1))
            .toString();
        }

        console.log(
          "ASK",
          " " + orderId.orderSequenceNumber.toString(),
          phoenix.ticksToFloatPrice(
            Phoenix.toNum(orderId.priceInTicks),
            marketAddress.toString()
          ),
          phoenix.baseAtomsToBaseUnits(
            phoenix.baseLotsToBaseAtoms(
              Phoenix.toNum(order.numBaseLots),
              marketAddress.toString()
            ),
            marketAddress.toString()
          ),
          timeRemaining
        );
      }
    }

    for (const [orderId, order] of market.data.bids) {
      if (Phoenix.toNum(order.traderIndex) === traderIndex) {
        let timeRemaining = "∞";
        if (order.lastValidSlot != 0) {
          if (order.lastValidSlot < slot) {
            continue;
          }
        }
        if (order.lastValidUnixTimestampInSeconds != 0) {
          if (order.lastValidUnixTimestampInSeconds < (time as BN)) {
            continue;
          }
          timeRemaining = (order.lastValidUnixTimestampInSeconds as BN)
            .sub(time as BN)
            .add(new BN(1))
            .toString();
        }

        console.log(
          "BID",
          getOrderSequenceNumber(orderId).toString(),
          phoenix.ticksToFloatPrice(
            Phoenix.toNum(orderId.priceInTicks),
            marketAddress.toString()
          ),
          phoenix.baseAtomsToBaseUnits(
            phoenix.baseLotsToBaseAtoms(
              Phoenix.toNum(order.numBaseLots),
              marketAddress.toString()
            ),
            marketAddress.toString()
          ),
          timeRemaining
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
