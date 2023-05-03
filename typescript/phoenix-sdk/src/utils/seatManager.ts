import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
import * as beet from "@metaplex-foundation/beet";
import * as beetSolana from "@metaplex-foundation/beet-solana";
import { getLogAuthority, getSeatAddress, Market, PROGRAM_ID } from "..";

import {
  createEvictSeatInstruction,
  createClaimSeatInstruction,
  PROGRAM_ID as PSM_PROGRAM_ID,
} from "../../psm-src/index";

/**
 * Deserializes seat manager data from a given buffer and returns a SeatManagerData object
 *
 * @param data The data buffer to deserialize
 */
export function deserializeSeatManagerData(data: Buffer): SeatManagerData {
  const seatManagerData = seatManagerBeet.deserialize(data, 0)[0];
  return seatManagerData;
}

export type SeatManagerData = {
  market: PublicKey;
  authority: PublicKey;
  successor: PublicKey;
  numMakers: beet.bignum;
  _headerPadding: beet.bignum[] /* size: 11 */;
  designatedMarketMaker: PublicKey[];
  _dmmPadding: beet.bignum[] /* size: 128 */;
};

export const seatManagerBeet = new beet.BeetArgsStruct<SeatManagerData>(
  [
    ["market", beetSolana.publicKey],
    ["authority", beetSolana.publicKey],
    ["successor", beetSolana.publicKey],
    ["numMakers", beet.u64],
    ["_headerPadding", beet.uniformFixedSizeArray(beet.u64, 11)],
    [
      "designatedMarketMaker",
      beet.uniformFixedSizeArray(beetSolana.publicKey, 128),
    ],
    ["_dmmPadding", beet.uniformFixedSizeArray(beet.u128, 128)],
  ],
  "SeatManagerData"
);

/**
 * Find the seat manager's address
 * @param marketPubkey The market's address
 */
export function getSeatManagerAddress(market: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [market.toBuffer()],
    PSM_PROGRAM_ID
  )[0];
}

/**
 * Get the seat deposit collector's address
 * @param marketPubkey The market's address
 */
export function getSeatDepositCollectorAddress(market: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [market.toBuffer(), Buffer.from("deposit")],
    PSM_PROGRAM_ID
  )[0];
}

/**
 * Returns an instruction to claim a seat on a market, via the Phoenix Seat Manager
 *
 * @param market The market's address
 * @param trader The trader's address
 */
export function getClaimSeatIx(
  market: PublicKey,
  trader: PublicKey
): TransactionInstruction {
  const seatManager = getSeatManagerAddress(market);
  const seatDepositCollector = getSeatDepositCollectorAddress(market);
  const seat = getSeatAddress(market, trader);
  const logAuthority = getLogAuthority();

  const claimSeatAccounts = {
    phoenixProgram: PROGRAM_ID,
    logAuthority,
    market,
    seatManager,
    seatDepositCollector,
    trader,
    payer: trader,
    seat,
  };

  return createClaimSeatInstruction(claimSeatAccounts);
}

/**
 * Returns an instruction to evict a seat on a market, via the Phoenix Seat Manager
 * Evict seat is only allowed if the trader state is full for a given market, unless performed by the seat manager authority
 *
 * @param market The market object
 * @param trader The address of the trader to be evicted
 * @param signer The address of the signer of the transaction. Does not need to be the trader if the market's trader state is full.
 * @param baseTokenAccountBackup The to-be-evicted trader's base token account backup, in the event the associated token account of the trader is no longer owned by the trader
 * @param quoteTokenAccountBackup The to-be-evicted trader's quote token account backup, in the event the associated token account of the trader is no longer owned by the trader
 */
export function getEvictSeatIx(
  market: Market,
  trader: PublicKey,
  signer: PublicKey,
  baseTokenAccountBackup?: PublicKey,
  quoteTokenAccountBackup?: PublicKey
): TransactionInstruction {
  const seatManager = getSeatManagerAddress(market.address);
  const seatDepositCollector = getSeatDepositCollectorAddress(market.address);
  const seat = getSeatAddress(market.address, trader);
  const logAuthority = getLogAuthority();

  const baseAccount = PublicKey.findProgramAddressSync(
    [
      trader.toBuffer(),
      TOKEN_PROGRAM_ID.toBuffer(),
      market.data.header.baseParams.mintKey.toBuffer(),
    ],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];
  const quoteAccount = PublicKey.findProgramAddressSync(
    [
      trader.toBuffer(),
      TOKEN_PROGRAM_ID.toBuffer(),
      market.data.header.quoteParams.mintKey.toBuffer(),
    ],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];

  const evictSeatAccounts = {
    phoenixProgram: PROGRAM_ID,
    logAuthority,
    market: market.address,
    seatManager,
    seatDepositCollector,
    baseMint: market.data.header.baseParams.mintKey,
    quoteMint: market.data.header.quoteParams.mintKey,
    baseVault: market.data.header.baseParams.vaultKey,
    quoteVault: market.data.header.quoteParams.vaultKey,
    associatedTokenAccountProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    signer,
    trader,
    seat,
    baseAccount,
    quoteAccount,
    baseAccountBackup: baseTokenAccountBackup ?? PublicKey.default,
    quoteAccountBackup: quoteTokenAccountBackup ?? PublicKey.default,
  };

  return createEvictSeatInstruction(evictSeatAccounts);
}

/**
 * Checks if the given trader has a seat on the given market
 * If not, return claim seat instructions
 * @param connection An instance of the Connection class
 * @param market The market object
 * @param trader The trader's address
 */
export async function confirmOrCreateClaimSeatIxs(
  connection: Connection,
  market: Market,
  trader: PublicKey
): Promise<TransactionInstruction[]> {
  const seat = market.getSeatAddress(trader);

  const instructions: TransactionInstruction[] = [];

  let seatAccountInfo;
  try {
    seatAccountInfo = await connection.getAccountInfo(seat, "confirmed");
  } catch {
    seatAccountInfo = null;
  }

  if (seatAccountInfo === null || seatAccountInfo.data.length == 0) {
    const traderToEvict = await findTraderToEvict(connection, market);
    if (traderToEvict) {
      instructions.push(getEvictSeatIx(market, traderToEvict, trader));
    }
    instructions.push(getClaimSeatIx(market.address, trader));
  }

  return instructions;
}

/**
 * Checks if the given trader has a seat on the given market
 * If not, return claim seat instructions
 * @param connection An instance of the Connection class
 * @param market The market object
 * @param trader The trader's address
 */
export async function createClaimSeatInstructions(
  connection: Connection,
  market: Market,
  trader: PublicKey
): Promise<TransactionInstruction[]> {
  const instructions: TransactionInstruction[] = [];
  const traderToEvict = await findTraderToEvict(connection, market);
  if (traderToEvict) {
    instructions.push(getEvictSeatIx(market, traderToEvict, trader));
  }
  instructions.push(getClaimSeatIx(market.address, trader));
  return instructions;
}

/**
 * Find a trader to evict from the given market.
 * If the market's trader state is not at capacity or if every trader has locked base or quote lots, then return undefined.
 * If the seats are full, this function will return the first trader that has no base or quote lots locked.
 * @param connection An instance of the Connection class
 * @param market The market object
 * @returns
 */
export async function findTraderToEvict(
  connection: Connection,
  market: Market
): Promise<PublicKey | void> {
  const traders = market.data.traders;

  const seatManagerAddress = getSeatManagerAddress(market.address);
  const seatManagerStruct: SeatManagerData = deserializeSeatManagerData(
    (await connection.getAccountInfo(seatManagerAddress, "confirmed")).data
  );

  if (traders.size >= Number(market.data.header.marketSizeParams.numSeats)) {
    for (const [traderToEvict, traderState] of traders) {
      if (traderState.baseLotsLocked == 0 && traderState.quoteLotsLocked == 0) {
        // A DMM cannot be evicted directly. They must first be removed as a DMM. Skip DMMs in this search.
        if (
          seatManagerStruct.designatedMarketMaker.includes(
            new PublicKey(traderToEvict)
          )
        ) {
          continue;
        }
        return new PublicKey(traderToEvict);
      }
    }
  }

  return undefined;
}
