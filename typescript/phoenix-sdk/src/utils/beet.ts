import { PublicKey } from "@solana/web3.js";
import * as beet from "@metaplex-foundation/beet";
import * as beetSolana from "@metaplex-foundation/beet-solana";

import { OrderId, RestingOrder, TraderState } from "../market";

type PubkeyWrapper = {
  publicKey: PublicKey;
};

export const publicKeyBeet = new beet.BeetArgsStruct<PubkeyWrapper>(
  [["publicKey", beetSolana.publicKey]],
  "PubkeyWrapper"
);

export const orderIdBeet = new beet.BeetArgsStruct<OrderId>(
  [
    ["priceInTicks", beet.u64],
    ["orderSequenceNumber", beet.u64],
  ],
  "fIFOOrderId"
);

export const restingOrderBeet = new beet.BeetArgsStruct<RestingOrder>(
  [
    ["traderIndex", beet.u64],
    ["numBaseLots", beet.u64],
    ["lastValidSlot", beet.u64],
    ["lastValidUnixTimestampInSeconds", beet.u64],
  ],
  "fIFORestingOrder"
);

export const traderStateBeet = new beet.BeetArgsStruct<TraderState>(
  [
    ["quoteLotsLocked", beet.u64],
    ["quoteLotsFree", beet.u64],
    ["baseLotsLocked", beet.u64],
    ["baseLotsFree", beet.u64],
    ["padding", beet.uniformFixedSizeArray(beet.u64, 8)],
  ],
  "TraderState"
);
