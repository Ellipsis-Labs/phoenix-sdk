import {
	ASSOCIATED_TOKEN_PROGRAM_ID,
	TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey, Transaction } from "@solana/web3.js";

import { PROGRAM_ID } from "../index";
import { Market } from "../market";
import { Side, SelfTradeBehavior, OrderPacket } from "../types";
import { toNum } from "../utils";
import { createSwapInstruction } from "../instructions";

export const DEFAULT_MATCH_LIMIT = 2048;
export const DEFAULT_SLIPPAGE_PERCENT = 0.005;

// TODO should this come from auto-generated ./types?
export enum SwapOrderType {
	limit = "Limit",
	ioc = "ImmediateOrCancel",
	postOnly = "PostOnly",
}

/**
 * Returns a Phoenix swap transaction
 *
 * @param market The market to swap on
 * @param type The type of order to place (limit, ioc, postOnly)
 * @param side The side of the order to place (Bid, Ask)
 * @param inAmount The amount of the input token to swap
 * @param trader The trader's wallet public key
 */
export function getSwapTransaction({
	market,
	side,
	inAmount,
	trader,
}: {
	market: Market;
	side: Side;
	inAmount: number;
	trader: PublicKey;
}): Transaction {
	const baseAccount = PublicKey.findProgramAddressSync(
		[
			trader.toBuffer(),
			TOKEN_PROGRAM_ID.toBuffer(),
			market.baseToken.data.mintKey.toBuffer(),
		],
		ASSOCIATED_TOKEN_PROGRAM_ID
	)[0];

	const quoteAccount = PublicKey.findProgramAddressSync(
		[
			trader.toBuffer(),
			TOKEN_PROGRAM_ID.toBuffer(),
			market.quoteToken.data.mintKey.toBuffer(),
		],
		ASSOCIATED_TOKEN_PROGRAM_ID
	)[0];

	const orderAccounts = {
		phoenixProgram: PROGRAM_ID,
		logAuthority: PublicKey.findProgramAddressSync(
			[Buffer.from("log")],
			PROGRAM_ID
		)[0],
		market: market.address,
		trader,
		baseAccount,
		quoteAccount,
		quoteVault: market.data.header.quoteParams.vaultKey,
		baseVault: market.data.header.baseParams.vaultKey,
	};

	const orderPacket = getSwapOrderPacket({
		market,
		side,
		inAmount,
	});

	const ix = createSwapInstruction(orderAccounts, {
		// @ts-ignore TODO why is __kind incompatible?
		orderPacket: {
			__kind: "ImmediateOrCancel",
			...orderPacket,
		},
	});

	return new Transaction().add(ix);
}

/**
 * Returns a Phoenix swap order packet
 *
 * @param market The market to submit the order to
 * @param side The side of the order
 * @param inAmount The amount of the input token
 * @param slippage The slippage tolerance in bps
 * @param selfTradeBehavior The self trade behavior
 * @param matchLimit The match limit
 * @param useOnlyDepositedFunds Whether to use only deposited funds
 */
export function getSwapOrderPacket({
	market,
	side,
	inAmount,
	slippage = DEFAULT_SLIPPAGE_PERCENT,
	selfTradeBehavior = SelfTradeBehavior.Abort,
	matchLimit = DEFAULT_MATCH_LIMIT,
	useOnlyDepositedFunds = false,
}: {
	market: Market;
	side: Side;
	inAmount: number;
	slippage?: number;
	selfTradeBehavior?: SelfTradeBehavior;
	matchLimit?: number;
	useOnlyDepositedFunds?: boolean;
}): Partial<OrderPacket> {
	const expectedOutAmount = getExpectedOutAmount({
		market,
		side,
		inAmount,
	});
	const baseMul = 10 ** market.baseToken.data.decimals;
	const quoteMul = 10 ** market.quoteToken.data.decimals;
	const slippageDenom = 1 - slippage;
	let numBaseLots = 0;
	let minBaseLotsToFill = 0;
	let numQuoteLots = 0;
	let minQuoteLotsToFill = 0;

	if (side === Side.Ask) {
		numBaseLots =
			(inAmount * baseMul) /
			parseFloat(market.data.header.baseLotSize.toString());
		minQuoteLotsToFill = Math.ceil(
			((expectedOutAmount * quoteMul) /
				parseFloat(market.data.header.quoteLotSize.toString())) *
				slippageDenom
		);
	} else {
		numQuoteLots =
			(inAmount * quoteMul) /
			parseFloat(market.data.header.quoteLotSize.toString());
		minBaseLotsToFill = Math.ceil(
			((expectedOutAmount * baseMul) /
				parseFloat(market.data.header.baseLotSize.toString())) *
				slippageDenom
		);
	}

	const order: Partial<OrderPacket> = {
		side,
		priceInTicks: null, // TODO what is this?
		numBaseLots,
		minBaseLotsToFill,
		numQuoteLots,
		minQuoteLotsToFill,
		selfTradeBehavior,
		matchLimit,
		clientOrderId: 0, // TODO what is this?
		useOnlyDepositedFunds,
	};

	return order;
}

/**
 * Returns the expected amount out for a given swap order
 *
 * @param market The market to calculate the amount out for
 * @param side The side of the order (Bid or Ask)
 * @param inAmount The amount of the input token
 */
export function getExpectedOutAmount({
	market,
	side,
	inAmount,
}: {
	market: Market;
	side: Side;
	inAmount: number;
}): number {
	const numBids = toNum(market.data.header.marketSizeParams.bidsSize);
	const numAsks = toNum(market.data.header.marketSizeParams.asksSize);
	const ladder = market.getUiLadder(Math.max(numBids, numAsks));

	if (side === Side.Bid) {
		let remainingQuoteUnits =
			inAmount * (1 - market.data.takerFeeBps / 10000);
		let expectedBaseUnitsReceived = 0;
		for (const [
			priceInQuoteUnitsPerBaseUnit,
			sizeInBaseUnits,
		] of ladder.asks) {
			let totalQuoteUnitsAvailable =
				sizeInBaseUnits * priceInQuoteUnitsPerBaseUnit;
			if (totalQuoteUnitsAvailable > remainingQuoteUnits) {
				expectedBaseUnitsReceived +=
					remainingQuoteUnits / priceInQuoteUnitsPerBaseUnit;
				remainingQuoteUnits = 0;
				break;
			} else {
				expectedBaseUnitsReceived += sizeInBaseUnits;
				remainingQuoteUnits -= totalQuoteUnitsAvailable;
			}
		}
		return expectedBaseUnitsReceived;
	} else {
		let remainingBaseUnits =
			inAmount * (1 - market.data.takerFeeBps / 10000);
		let expectedQuoteUnitsReceived = 0;
		for (const [
			priceInQuoteUnitsPerBaseUnit,
			sizeInBaseUnits,
		] of ladder.bids) {
			if (sizeInBaseUnits > remainingBaseUnits) {
				expectedQuoteUnitsReceived +=
					remainingBaseUnits * priceInQuoteUnitsPerBaseUnit;
				remainingBaseUnits = 0;
				break;
			} else {
				expectedQuoteUnitsReceived +=
					sizeInBaseUnits * priceInQuoteUnitsPerBaseUnit;
				remainingBaseUnits -= sizeInBaseUnits;
			}
		}

		return expectedQuoteUnitsReceived;
	}
}
