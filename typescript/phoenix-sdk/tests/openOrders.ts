import { Connection } from "@solana/web3.js";

import * as Phoenix from "../src";

const getOrderSequenceNumber = (orderId: Phoenix.OrderId): bigint => {
  const num = BigInt(orderId.orderSequenceNumber.toString()); // 64-bit integer (maximum value)
  const low = Number(num & BigInt(0xffffffff)); // lower 32 bits
  const high = Number(num >> 32n); // upper 32 bits
  const inverseLow = ~low >>> 0; // perform bitwise NOT on lower 32 bits
  const inverseHigh = ~high >>> 0; // perform bitwise NOT on upper 32 bits
  const sequenceNumber = (BigInt(inverseHigh) << 32n) | BigInt(inverseLow); // combine the results
  return sequenceNumber;
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
    // console.clear();
    console.log("Open Orders for trader: " + traderKey + "\n");
    const slot = phoenix.clock.slot;
    const time = phoenix.clock.unixTimestamp;
    for (const [orderId, order] of market.data.asks) {
      if (Phoenix.toNum(order.traderIndex) === traderIndex) {
        let timeRemaining = "∞";
        if (order.lastValidSlot != 0) {
          if (BigInt(order.lastValidSlot.toString()) < slot) {
            continue;
          }
        }
        if (order.lastValidUnixTimestampInSeconds != 0) {
          if (BigInt(order.lastValidUnixTimestampInSeconds.toString()) < time) {
            continue;
          }
          const expTime = BigInt(
            order.lastValidUnixTimestampInSeconds.toString()
          );
          const diff = expTime - time;
          timeRemaining = diff.toString();
        }

        console.log(
          "ASK",
          getOrderSequenceNumber(orderId),
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

      for (const [orderId, order] of market.data.bids) {
        if (Phoenix.toNum(order.traderIndex) === traderIndex) {
          let timeRemaining = "∞";
          if (order.lastValidSlot != 0) {
            if (BigInt(order.lastValidSlot.toString()) < slot) {
              continue;
            }
          }
          if (order.lastValidUnixTimestampInSeconds != 0) {
            if (
              BigInt(order.lastValidUnixTimestampInSeconds.toString()) < time
            ) {
              continue;
            }
            timeRemaining = (
              BigInt(order.lastValidUnixTimestampInSeconds.toString()) - time
            ).toString();
          }

          console.log(
            "BID",
            getOrderSequenceNumber(orderId),
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
        await phoenix.refreshMarket(marketAddress);
        await new Promise((res) => setTimeout(res, 500));
      }
    }
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
