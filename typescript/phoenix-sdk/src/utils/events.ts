import {
  Connection,
  PartiallyDecodedInstruction,
  PublicKey,
} from "@solana/web3.js";
import { BinaryReader } from "borsh";
import base58 from "bs58";
import BN from "bn.js";

import { PROGRAM_ID } from "../index";
import {
  AuditLogHeader,
  EvictEvent,
  FeeEvent,
  FillEvent,
  FillSummaryEvent,
  PlaceEvent,
  ReduceEvent,
  PhoenixMarketEvent,
} from "../types";
import { logInstructionDiscriminator } from "../instructions";

export type PhoenixTransaction = {
  instructions: Array<PhoenixEvent>;
};

export type PhoenixEvent = {
  header: AuditLogHeader;
  enums: Array<PhoenixMarketEvent>;
  events: Array<
    | FillEvent
    | PlaceEvent
    | ReduceEvent
    | EvictEvent
    | FillSummaryEvent
    | FeeEvent
  >;
};

export function readPublicKey(reader: BinaryReader): PublicKey {
  return new PublicKey(reader.readFixedArray(32));
}

export async function getEventsFromTransaction(
  connection: Connection,
  signature: string
): Promise<PhoenixTransaction> {
  const txData = await connection.getParsedTransaction(signature, "confirmed");
  const innerIxs = txData?.meta?.innerInstructions;
  if (!innerIxs || !txData || !txData.slot) {
    return { instructions: [] };
  }

  let logData = [];
  for (const ix of innerIxs) {
    for (const inner of ix.instructions) {
      if (inner.programId.toBase58() != PROGRAM_ID.toBase58()) {
        continue;
      }
      const rawData = base58.decode(
        (inner as PartiallyDecodedInstruction).data
      );
      if (rawData[0] == logInstructionDiscriminator) {
        logData.push(rawData.slice(1));
      }
    }
  }
  let instructions = new Array<PhoenixEvent>();

  for (const data of logData) {
    let reader = new BinaryReader(Buffer.from(data));
    let byte = reader.readU8() as PhoenixMarketEvent;
    if (byte != PhoenixMarketEvent.Header) {
      throw new Error("early Unexpected event");
    }

    let tradeEvents = new Array<
      | FillEvent
      | PlaceEvent
      | ReduceEvent
      | EvictEvent
      | FillSummaryEvent
      | FeeEvent
    >();

    let enums = new Array<PhoenixMarketEvent>();

    let header = {
      instruction: reader.readU8(),
      sequenceNumber: reader.readU64(),
      timestamp: reader.readU64(),
      slot: reader.readU64(),
      market: readPublicKey(reader),
      signer: readPublicKey(reader),
      totalEvents: reader.readU16(),
    };

    while (reader.offset < reader.buf.length) {
      // console.log("reading");
      const e = reader.readU8() as PhoenixMarketEvent;
      switch (e) {
        case PhoenixMarketEvent.Fill:
          tradeEvents.push({
            index: reader.readU16(),
            makerId: readPublicKey(reader),
            orderSequenceNumber: new BN(reader.readFixedArray(8)),
            priceInTicks: reader.readU64(),
            baseLotsFilled: reader.readU64(),
            baseLotsRemaining: reader.readU64(),
          });
          break;
        case PhoenixMarketEvent.Place:
          tradeEvents.push({
            index: reader.readU16(),
            orderSequenceNumber: new BN(reader.readFixedArray(8)),
            clientOrderId: reader.readU64(),
            priceInTicks: reader.readU64(),
            baseLotsPlaced: reader.readU64(),
          });
          break;
        case PhoenixMarketEvent.Reduce:
          tradeEvents.push({
            index: reader.readU16(),
            orderSequenceNumber: reader.readU64(),
            priceInTicks: reader.readU64(),
            baseLotsRemoved: reader.readU64(),
            baseLotsRemaining: reader.readU64(),
          });
          break;
        case PhoenixMarketEvent.Evict:
          tradeEvents.push({
            index: reader.readU16(),
            makerId: readPublicKey(reader),
            orderSequenceNumber: reader.readU64(),
            priceInTicks: reader.readU64(),
            baseLotsEvicted: reader.readU64(),
          });
          break;
        case PhoenixMarketEvent.FillSummary:
          tradeEvents.push({
            index: reader.readU16(),
            clientOrderId: reader.readU128(),
            totalBaseLotsFilled: reader.readU64(),
            totalQuoteLotsFilled: reader.readU64(),
            totalFeeInQuoteLots: reader.readU64(),
          });
          break;
        case PhoenixMarketEvent.Fee:
          tradeEvents.push({
            index: reader.readU16(),
            feesCollectedInQuoteLots: reader.readU64(),
          });
          break;
        default:
          throw Error("Unexpected Event");
      }
      enums.push(e);
    }
    instructions.push({
      header: header,
      events: tradeEvents,
      enums: enums,
    });
  }
  return { instructions: instructions };
}
