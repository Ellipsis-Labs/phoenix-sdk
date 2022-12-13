import * as beet from "@metaplex-foundation/beet";
import { PublicKey } from "@solana/web3.js";
import * as beetSolana from "@metaplex-foundation/beet-solana";
import { MarketHeader, marketHeaderBeet } from "./types/MarketHeader";

export const toNum = (n: beet.bignum) => {
  let target: number;
  if (typeof n === "number") {
    target = n;
  } else {
    target = n.toNumber();
  }
  return target;
};

export type OrderId = {
  priceInTicks: beet.bignum;
  orderSequenceNumber: beet.bignum;
};

export const orderIdBeet = new beet.BeetArgsStruct<OrderId>(
  [
    ["priceInTicks", beet.u64],
    ["orderSequenceNumber", beet.u64],
  ],
  "fIFOOrderId"
);

export type RestingOrder = {
  traderIndex: beet.bignum;
  numBaseLots: beet.bignum;
};

export const restingOrderBeet = new beet.BeetArgsStruct<RestingOrder>(
  [
    ["traderIndex", beet.u64],
    ["numBaseLots", beet.u64],
  ],
  "fIFORestingOrder"
);

export type TraderState = {
  quoteLotsLocked: beet.bignum;
  quoteLotsFree: beet.bignum;
  baseLotsLocked: beet.bignum;
  baseLotsFree: beet.bignum;
};

export const traderStateBeet = new beet.BeetArgsStruct<TraderState>(
  [
    ["quoteLotsLocked", beet.u64],
    ["quoteLotsFree", beet.u64],
    ["baseLotsLocked", beet.u64],
    ["baseLotsFree", beet.u64],
  ],
  "TraderState"
);

type PubkeyWrapper = {
  publicKey: PublicKey;
};

const publicKeyBeet = new beet.BeetArgsStruct<PubkeyWrapper>(
  [["publicKey", beetSolana.publicKey]],
  "PubkeyWrapper"
);

export class Market {
  header: MarketHeader;
  baseLotsPerBaseUnit: number;
  quoteLotsPerBaseUnitPerTick: number;
  sequenceNumber: number;
  takerFeeBps: number;
  collectedAdjustedQuoteLotFees: number;
  unclaimedAdjustedQuoteLotFees: number;
  bids: Array<[OrderId, RestingOrder]>;
  asks: Array<[OrderId, RestingOrder]>;
  traders: Map<PublicKey, TraderState>;

  constructor(
    header: MarketHeader,
    baseLotsPerBaseUnit: number,
    quoteLotsPerBaseUnitPerTick: number,
    sequenceNumber: number,
    takerFeeBps: number,
    collectedAdjustedQuoteLotFees: number,
    unclaimedAdjustedQuoteLotFees: number,
    bids: Array<[OrderId, RestingOrder]>,
    asks: Array<[OrderId, RestingOrder]>,
    traders: Map<PublicKey, TraderState>
  ) {
    this.header = header;
    this.baseLotsPerBaseUnit = baseLotsPerBaseUnit;
    this.quoteLotsPerBaseUnitPerTick = quoteLotsPerBaseUnitPerTick;
    this.sequenceNumber = sequenceNumber;
    this.takerFeeBps = takerFeeBps;
    this.collectedAdjustedQuoteLotFees = collectedAdjustedQuoteLotFees;
    this.unclaimedAdjustedQuoteLotFees = unclaimedAdjustedQuoteLotFees;
    this.bids = bids;
    this.asks = asks;
    this.traders = traders;
  }

  getLadder(levels: number): Ladder {
    let bids: Array<[number, number]> = [];
    let asks: Array<[number, number]> = [];
    const quoteAtomsPerQuoteUnit = 10 ** toNum(this.header.quoteParams.decimals);
    for (const [orderId, restingOrder] of this.bids) {
      if (bids.length === 0) {
        let priceInTicks = toNum(orderId.priceInTicks);
        bids.push([
          (priceInTicks *
            this.quoteLotsPerBaseUnitPerTick *
            toNum(this.header.quoteLotSize)) /
            quoteAtomsPerQuoteUnit,
          toNum(restingOrder.numBaseLots) / this.baseLotsPerBaseUnit,
        ]);
      } else {
        let prev = bids[bids.length - 1];
        if (!prev) {
          throw Error;
        }
        let priceInTicks = toNum(orderId.priceInTicks);
        let price =
          (priceInTicks *
            this.quoteLotsPerBaseUnitPerTick *
            toNum(this.header.quoteLotSize)) /
          quoteAtomsPerQuoteUnit;
        if (price === prev[0]) {
          prev[1] += toNum(restingOrder.numBaseLots) / this.baseLotsPerBaseUnit;
        } else {
          if (bids.length == levels) {
            break;
          }
          bids.push([
            price,
            toNum(restingOrder.numBaseLots) / this.baseLotsPerBaseUnit,
          ]);
        }
      }
    }

    for (const [orderId, restingOrder] of this.asks) {
      if (asks.length === 0) {
        let priceInTicks = toNum(orderId.priceInTicks);
        asks.push([
          (priceInTicks *
            this.quoteLotsPerBaseUnitPerTick *
            toNum(this.header.quoteLotSize)) /
            quoteAtomsPerQuoteUnit,
          toNum(restingOrder.numBaseLots) / this.baseLotsPerBaseUnit,
        ]);
      } else {
        let prev = asks[asks.length - 1];
        if (!prev) {
          throw Error;
        }
        let priceInTicks = toNum(orderId.priceInTicks);
        let price =
          (priceInTicks *
            this.quoteLotsPerBaseUnitPerTick *
            toNum(this.header.quoteLotSize)) /
          quoteAtomsPerQuoteUnit;
        if (price === prev[0]) {
          prev[1] += toNum(restingOrder.numBaseLots) / this.baseLotsPerBaseUnit;
        } else {
          if (asks.length == levels) {
            break;
          }
          asks.push([
            price,
            toNum(restingOrder.numBaseLots) / this.baseLotsPerBaseUnit,
          ]);
        }
      }
    }
    return new Ladder(asks.reverse().slice(0, levels), bids.slice(0, levels));
  }
}

export class Ladder {
  bids: Array<[number, number]>;
  asks: Array<[number, number]>;

  constructor(asks: Array<[number, number]>, bids: Array<[number, number]>) {
    this.asks = asks;
    this.bids = bids;
  }
}

// This dserializes the market and returns a Market object
// This struct is defined here: https://github.com/Ellipsis-Labs/phoenix-types/blob/ab8ecbf168cebbe157c77a2eb64598781b8d317b/src/market.rs#L198
export const deserializeMarket = (data: Buffer): Market => {
  let offset = marketHeaderBeet.byteSize;
  const [header] = marketHeaderBeet.deserialize(data.subarray(0, offset));
  let remaining = data.subarray(offset);

  offset = 0;
  let baseLotsPerBaseUnit = Number(remaining.readBigUInt64LE(offset));
  offset += 8;
  let quoteLotsPerTick = Number(remaining.readBigUInt64LE(offset));
  offset += 8;
  let sequenceNumber = Number(remaining.readBigUInt64LE(offset));
  offset += 8;
  let takerFeeBps = Number(remaining.readBigUInt64LE(offset));
  offset += 8;
  let collectedAdjustedQuoteLotFees = Number(remaining.readBigUInt64LE(offset));
  offset += 8;
  let unclaimedAdjustedQuoteLotFees = Number(remaining.readBigUInt64LE(offset));
  offset += 8;

  remaining = remaining.subarray(offset);

  let numBids = toNum(header.marketSizeParams.bidsSize);
  let numAsks = toNum(header.marketSizeParams.asksSize);
  let numTraders = toNum(header.marketSizeParams.numSeats);

  const bidsSize =
    16 + 16 + (16 + orderIdBeet.byteSize + restingOrderBeet.byteSize) * numBids;
  const asksSize =
    16 + 16 + (16 + orderIdBeet.byteSize + restingOrderBeet.byteSize) * numAsks;
  const tradersSize =
    16 + 16 + (16 + 32 + traderStateBeet.byteSize) * numTraders;
  offset = 0;
  let bidBuffer = remaining.subarray(offset, offset + bidsSize);
  offset += bidsSize;
  let askBuffer = remaining.subarray(offset, offset + asksSize);
  offset += asksSize;
  let traderBuffer = remaining.subarray(offset, offset + tradersSize);

  let bidsUnsorted = deserializeRedBlackTree(
    bidBuffer,
    orderIdBeet,
    restingOrderBeet
  );
  let asksUnsorted = deserializeRedBlackTree(
    askBuffer,
    orderIdBeet,
    restingOrderBeet
  );

  // TODO: Respect price-time ordering
  let bids = [...bidsUnsorted].sort(
    (a, b) => toNum(-a[0].priceInTicks) + toNum(b[0].priceInTicks)
  );

  // TODO: Respect price-time ordering
  let asks = [...asksUnsorted].sort(
    (a, b) => toNum(a[0].priceInTicks) - toNum(b[0].priceInTicks)
  );

  let traders = new Map<PublicKey, TraderState>();
  for (const [k, traderState] of deserializeRedBlackTree(
    traderBuffer,
    publicKeyBeet,
    traderStateBeet
  )) {
    traders.set(k.publicKey, traderState);
  }

  return new Market(
    header,
    baseLotsPerBaseUnit,
    quoteLotsPerTick,
    sequenceNumber,
    takerFeeBps,
    collectedAdjustedQuoteLotFees,
    unclaimedAdjustedQuoteLotFees,
    bids,
    asks,
    traders
  );
};

// This deserialized the RedBlackTree defined in the sokoban library
// https://github.com/Ellipsis-Labs/sokoban/tree/master
function deserializeRedBlackTree<Key, Value>(
  buffer: Buffer,
  keyDeserializer: beet.BeetArgsStruct<Key>,
  valueDeserializer: beet.BeetArgsStruct<Value>
): Map<Key, Value> {
  let tree = new Map<Key, Value>();
  let offset = 0;
  let keySize = keyDeserializer.byteSize;
  let valueSize = valueDeserializer.byteSize;

  let nodes = new Array<[Key, Value]>();

  // skip RBTree header
  offset += 16;

  // Skip node allocator size
  offset += 8;
  let bumpIndex = buffer.readInt32LE(offset);
  offset += 4;
  let freeListHead = buffer.readInt32LE(offset);
  offset += 4;

  let freeListPointers = new Array<[number, number]>();

  for (let index = 0; offset < buffer.length && index < bumpIndex; index++) {
    let registers = new Array<number>();
    for (let i = 0; i < 4; i++) {
      registers.push(buffer.readInt32LE(offset)); // skip padding
      offset += 4;
    }
    let [key] = keyDeserializer.deserialize(
      buffer.subarray(offset, offset + keySize)
    );
    offset += keySize;
    let [value] = valueDeserializer.deserialize(
      buffer.subarray(offset, offset + valueSize)
    );
    offset += valueSize;
    nodes.push([key, value]);
    freeListPointers.push([index, registers[0]]);
  }

  let freeNodes = new Set<number>();
  let indexToRemove = freeListHead - 1;
  let counter = 0;
  // If there's an infinite loop here, that means that the state is corrupted
  while (freeListHead !== 0) {
    // We need to subtract 1 because the node allocator is 1-indexed
    let next = freeListPointers[freeListHead - 1];
    [indexToRemove, freeListHead] = next;
    freeNodes.add(indexToRemove);
    counter += 1;
    if (counter > bumpIndex) {
      throw new Error("Infinite loop detected");
    }
  }

  for (let [index, [key, value]] of nodes.entries()) {
    if (!freeNodes.has(index)) {
      tree.set(key, value);
    }
  }

  return tree;
}
