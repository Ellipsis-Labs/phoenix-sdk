import { PublicKey } from "@solana/web3.js";
import * as beet from "@metaplex-foundation/beet";
import * as beetSolana from "@metaplex-foundation/beet-solana";

import { OrderId, RestingOrder, TraderState } from "../market";

export const publicKeyBeet = new beet.BeetArgsStruct<{
  publicKey: PublicKey;
}>([["publicKey", beetSolana.publicKey]], "PubkeyWrapper");

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
    ["padding_1", beet.u64],
    ["padding_2", beet.u64],
  ],
  "fIFORestingOrder"
);

export const traderStateBeet = new beet.BeetArgsStruct<TraderState>(
  [
    ["quoteLotsLocked", beet.u64],
    ["quoteLotsFree", beet.u64],
    ["baseLotsLocked", beet.u64],
    ["baseLotsFree", beet.u64],
    ["padding_1", beet.u64],
    ["padding_2", beet.u64],
    ["padding_3", beet.u64],
    ["padding_4", beet.u64],
    ["padding_5", beet.u64],
    ["padding_6", beet.u64],
    ["padding_7", beet.u64],
    ["padding_8", beet.u64],
  ],
  "TraderState"
);
