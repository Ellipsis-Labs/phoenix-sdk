import {
  Connection,
  ParsedTransactionWithMeta,
  PartiallyDecodedInstruction,
  PublicKey,
  TransactionSignature,
} from "@solana/web3.js";
import { BinaryReader } from "borsh";
import base58 from "bs58";
import * as beet from "@metaplex-foundation/beet";

import { PROGRAM_ID } from "./index";
import {
  AuditLogHeader,
  PhoenixMarketEvent,
  phoenixMarketEventBeet,
} from "./types";
import { logInstructionDiscriminator } from "./instructions";

export type PhoenixTransaction = {
  instructions: Array<PhoenixEventsFromInstruction>;
  signature?: TransactionSignature;
  txReceived: boolean;
  txFailed: boolean;
};

export type PhoenixEventsFromInstruction = {
  header: AuditLogHeader;
  events: Array<PhoenixMarketEvent>;
};

export type PhoenixEvents = {
  events: PhoenixMarketEvent[];
};

export const phoenixEventsBeet = new beet.FixableBeetArgsStruct<PhoenixEvents>(
  [["events", beet.array(phoenixMarketEventBeet)]],
  "PhoenixEvents"
);

export function decodePhoenixEvents(data: Uint8Array): PhoenixMarketEvent[] {
  const buffer: Buffer = Buffer.from(data);
  const [events] = phoenixEventsBeet.deserialize(buffer, 0);
  return events.events;
}

export function readPublicKey(reader: BinaryReader): PublicKey {
  return new PublicKey(reader.readFixedArray(32));
}

export function getPhoenixEventsFromLogData(
  data: Uint8Array
): PhoenixEventsFromInstruction {
  // Decode the header by hand
  const reader = new BinaryReader(Buffer.from(data));
  const byte = reader.readU8();
  // A byte of 1 identifies a header event
  if (byte != 1) {
    throw new Error("early Unexpected event");
  }
  const header = {
    instruction: reader.readU8(),
    sequenceNumber: reader.readU64(),
    timestamp: reader.readU64(),
    slot: reader.readU64(),
    market: readPublicKey(reader),
    signer: readPublicKey(reader),
    totalEvents: reader.readU16(),
  };

  // Borsh serializes the length of the vector as a u32
  const lengthBuffer = new ArrayBuffer(4);
  const view = new DataView(lengthBuffer);
  // The size of the vector in the header event is a u16
  view.setUint16(0, header.totalEvents, true);

  // By coercing the buffer to have the same byte serialization as a
  // Borsh-encoded vector, we can leverage the Borsh deserializer to decode
  // the events
  const events = decodePhoenixEvents(
    Buffer.concat([
      Buffer.from(lengthBuffer),
      Buffer.from(data.slice(reader.offset)),
    ])
  );

  return {
    header: header,
    events: events,
  };
}

/**
 * Returns a list of Phoenix events for a given transaction object
 *
 * @param txData The transaction object returned by `getParsedTransaction` of type `ParsedTransactionWithMeta`
 */
export function getPhoenixEventsFromTransactionData(
  txData: ParsedTransactionWithMeta
): PhoenixTransaction {
  const meta = txData?.meta;
  if (meta === undefined) {
    return { instructions: [], txReceived: false, txFailed: true };
  }

  if (meta?.err !== null) {
    return { instructions: [], txReceived: true, txFailed: true };
  }

  const innerIxs = txData?.meta?.innerInstructions;
  if (!innerIxs || !txData || !txData.slot) {
    return { instructions: [], txReceived: true, txFailed: true };
  }

  const logData: Array<Uint8Array> = [];
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
  const instructions = new Array<PhoenixEventsFromInstruction>();

  for (const data of logData) {
    instructions.push(getPhoenixEventsFromLogData(data));
  }
  return {
    instructions: instructions,
    signature: txData.transaction.signatures[0],
    txReceived: true,
    txFailed: false,
  };
}

/**
 * Returns a list of Phoenix events for a given transaction signature
 *
 * @param connection The Solana `Connection` object
 * @param signature The signature of the transaction to fetch
 */
export async function getPhoenixEventsFromTransactionSignature(
  connection: Connection,
  signature: string
): Promise<PhoenixTransaction> {
  const txData = await connection.getParsedTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 1,
  });
  return getPhoenixEventsFromTransactionData(txData);
}

/**
 * Returns a list of Phoenix events for a given transaction signature
 *
 * @param connection The Solana `Connection` object
 * @param signature The signature of the transaction to fetch
 * @deprecated The method is deprecated. Please use `getPhoenixEventsFromTransactionSignature` instead
 */
export async function getEventsFromTransaction(
  connection: Connection,
  signature: TransactionSignature
): Promise<PhoenixTransaction> {
  const txData = await connection.getParsedTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 1,
  });
  return getPhoenixEventsFromTransactionData(txData);
}
