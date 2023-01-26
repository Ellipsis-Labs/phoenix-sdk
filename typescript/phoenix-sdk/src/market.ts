import { Connection, PublicKey } from "@solana/web3.js";
import { WalletAdapter } from "@solana/wallet-adapter-base";
import * as beet from "@metaplex-foundation/beet";
import * as beetSolana from "@metaplex-foundation/beet-solana";
import BN from "bn.js";

import CONFIG from "../config.json";
import { Token } from "./token";
import { toNum, toBN, getSwapTransaction, SwapOrderType } from "./utils";
import { MarketHeader, marketHeaderBeet, Side } from "./types";

export const DEFAULT_LADDER_DEPTH = 10;

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

const publicKeyBeet = new beet.BeetArgsStruct<{
	publicKey: PublicKey;
}>([["publicKey", beetSolana.publicKey]], "PubkeyWrapper");

export type Ladder = {
	bids: Array<[BN, BN]>;
	asks: Array<[BN, BN]>;
};
export type UiLadder = {
	bids: Array<[number, number]>;
	asks: Array<[number, number]>;
};

export interface MarketData {
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
}

export class Market {
	name: string;
	address: PublicKey;
	baseToken: Token;
	quoteToken: Token;
	data: MarketData;

	constructor({
		name,
		address,
		baseToken,
		quoteToken,
		data,
	}: {
		name: string;
		address: PublicKey;
		baseToken: Token;
		quoteToken: Token;
		data: MarketData;
	}) {
		this.name = name;
		this.address = address;
		this.baseToken = baseToken;
		this.quoteToken = quoteToken;
		this.data = data;
	}

	/**
	 * Returns a `Market` for a given market address.
	 *
	 * @param connection The Solana `Connection` object
	 * @param marketAddress The `PublicKey` of the market account
	 */
	static async loadMarket(
		connection: Connection,
		address: PublicKey
	): Promise<Market> {
		// Fetch the account data for the market
		const account = await connection.getAccountInfo(address);
		if (!account)
			throw new Error(
				"Account not found for market: " + address.toBase58()
			);
		const buffer = Buffer.from(account.data);

		// Deserialize the market header
		let offset = marketHeaderBeet.byteSize;
		const [header] = marketHeaderBeet.deserialize(
			buffer.subarray(0, offset)
		);

		// Parse market data
		let remaining = buffer.subarray(offset);
		offset = 0;
		const baseLotsPerBaseUnit = Number(remaining.readBigUInt64LE(offset));
		offset += 8;
		const quoteLotsPerBaseUnitPerTick = Number(
			remaining.readBigUInt64LE(offset)
		);
		offset += 8;
		const sequenceNumber = Number(remaining.readBigUInt64LE(offset));
		offset += 8;
		const takerFeeBps = Number(remaining.readBigUInt64LE(offset));
		offset += 8;
		const collectedAdjustedQuoteLotFees = Number(
			remaining.readBigUInt64LE(offset)
		);
		offset += 8;
		const unclaimedAdjustedQuoteLotFees = Number(
			remaining.readBigUInt64LE(offset)
		);
		offset += 8;
		remaining = remaining.subarray(offset);

		// Parse bids, asks and traders
		const numBids = toNum(header.marketSizeParams.bidsSize);
		const numAsks = toNum(header.marketSizeParams.asksSize);
		const numTraders = toNum(header.marketSizeParams.numSeats);
		const bidsSize =
			16 +
			16 +
			(16 + orderIdBeet.byteSize + restingOrderBeet.byteSize) * numBids;
		const asksSize =
			16 +
			16 +
			(16 + orderIdBeet.byteSize + restingOrderBeet.byteSize) * numAsks;
		const tradersSize =
			16 + 16 + (16 + 32 + traderStateBeet.byteSize) * numTraders;
		offset = 0;

		const bidBuffer = remaining.subarray(offset, offset + bidsSize);
		offset += bidsSize;
		const askBuffer = remaining.subarray(offset, offset + asksSize);
		offset += asksSize;
		const traderBuffer = remaining.subarray(offset, offset + tradersSize);

		const bidsUnsorted = deserializeRedBlackTree(
			bidBuffer,
			orderIdBeet,
			restingOrderBeet
		);
		const asksUnsorted = deserializeRedBlackTree(
			askBuffer,
			orderIdBeet,
			restingOrderBeet
		);

		// TODO: Respect price-time ordering
		const bids = [...bidsUnsorted].sort(
			(a, b) => toNum(-a[0].priceInTicks) + toNum(b[0].priceInTicks)
		);

		// TODO: Respect price-time ordering
		const asks = [...asksUnsorted].sort(
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

		// Parse token config data
		const allTokens = Object.values(CONFIG)
			.map(({ tokens }) => tokens)
			.flat();
		const baseTokenConfig = allTokens.find(
			(token) => token.mint === header.baseParams.mintKey.toBase58()
		);
		const baseToken = new Token({
			name: baseTokenConfig.name,
			symbol: baseTokenConfig.symbol,
			logoUri: baseTokenConfig.logoUri,
			data: {
				...header.baseParams,
			},
		});
		const quoteTokenConfig = allTokens.find(
			(token) => token.mint === header.quoteParams.mintKey.toBase58()
		);
		const quoteToken = new Token({
			name: quoteTokenConfig.name,
			symbol: quoteTokenConfig.symbol,
			logoUri: quoteTokenConfig.logoUri,
			data: {
				...header.quoteParams,
			},
		});

		// Parse market name and construct data object
		const name = `${baseToken.symbol}/${quoteToken.symbol}`;
		const data: MarketData = {
			header,
			baseLotsPerBaseUnit,
			quoteLotsPerBaseUnitPerTick,
			sequenceNumber,
			takerFeeBps,
			collectedAdjustedQuoteLotFees,
			unclaimedAdjustedQuoteLotFees,
			bids,
			asks,
			traders,
		};

		return new Market({
			name,
			address,
			baseToken,
			quoteToken,
			data,
		});
	}

	/**
	 * Returns the market's ladder of bids and asks
	 *
	 * @param levels The number of book levels to return
	 * @param asUiLadder Whether to return bids and asks as JS numbers
	 */
	getLadder(levels: number = DEFAULT_LADDER_DEPTH): Ladder {
		let bids: Array<[BN, BN]> = [];
		let asks: Array<[BN, BN]> = [];
		for (const [orderId, restingOrder] of this.data.bids) {
			const priceInTicks = toBN(orderId.priceInTicks);
			const numBaseLots = toBN(restingOrder.numBaseLots);

			if (bids.length === 0) {
				bids.push([priceInTicks, numBaseLots]);
			} else {
				const prev = bids[bids.length - 1];
				if (!prev) {
					throw Error;
				}
				if (priceInTicks.eq(prev[0])) {
					prev[1] = numBaseLots;
				} else {
					if (bids.length === levels) {
						break;
					}
					bids.push([priceInTicks, numBaseLots]);
				}
			}
		}

		for (const [orderId, restingOrder] of this.data.asks) {
			const priceInTicks = toBN(orderId.priceInTicks);
			const numBaseLots = toBN(restingOrder.numBaseLots);
			if (asks.length === 0) {
				asks.push([priceInTicks, numBaseLots]);
			} else {
				const prev = asks[asks.length - 1];
				if (!prev) {
					throw Error;
				}
				if (priceInTicks.eq(prev[0])) {
					prev[1] = prev[1].add(numBaseLots);
				} else {
					if (asks.length === levels) {
						break;
					}
					asks.push([priceInTicks, numBaseLots]);
				}
			}
		}

		return {
			asks: asks.reverse().slice(0, levels),
			bids: bids.slice(0, levels),
		};
	}

	/**
	 * Converts a ladder level from BN to JS number representation
	 *
	 * @param priceInTicks The price of the level in ticks
	 * @param sizeInBaseLots The size of the level in base lots
	 * @param quoteAtomsPerQuoteUnit The number of quote atoms per quote unit
	 */
	private levelToUiLevel(
		priceInTicks: BN,
		sizeInBaseLots: BN,
		quoteAtomsPerQuoteUnit: number
	): [number, number] {
		return [
			(toNum(priceInTicks) *
				this.data.quoteLotsPerBaseUnitPerTick *
				toNum(this.data.header.quoteLotSize)) /
				quoteAtomsPerQuoteUnit,
			toNum(sizeInBaseLots) / this.data.baseLotsPerBaseUnit,
		];
	}

	/**
	 * Returns the market's ladder of bids and asks as JS numbers
	 *
	 * @param levels The number of book levels to return
	 */
	getUiLadder(levels: number = DEFAULT_LADDER_DEPTH): UiLadder {
		const ladder = this.getLadder(levels);

		const quoteAtomsPerQuoteUnit =
			10 ** toNum(this.data.header.quoteParams.decimals);
		return {
			bids: ladder.bids.map(([priceInTicks, sizeInBaseLots]) =>
				this.levelToUiLevel(
					priceInTicks,
					sizeInBaseLots,
					quoteAtomsPerQuoteUnit
				)
			),
			asks: ladder.asks.map(([priceInTicks, sizeInBaseLots]) =>
				this.levelToUiLevel(
					priceInTicks,
					sizeInBaseLots,
					quoteAtomsPerQuoteUnit
				)
			),
		};
	}

	/**
	 * Submits a swap order to the market
	 *
	 * @param connection The Solana `Connection` to use
	 * @param wallet The `WalletAdapter` of the trader to sign and send the order
	 * @param type The type of swap to perform ("Limit", "ImmediateOrCancel", or "PostOnly")
	 * @param side The side of the swap ("Bid" or "Ask")
	 * @param inAmount The amount of the input token to swap
	 */
	async swap({
		connection,
		wallet,
		type,
		side,
		inAmount,
	}: {
		connection: Connection;
		wallet: WalletAdapter;
		type: SwapOrderType;
		side: Side;
		inAmount: number;
	}): Promise<string> {
		const tx = getSwapTransaction({
			market: this,
			type,
			side,
			inAmount,
			trader: wallet.publicKey,
		});

		try {
			const txId = await wallet.sendTransaction(tx, connection, {
				skipPreflight: true,
			});
			return txId;
		} catch (err) {
			throw new Error("Error sending swap transaction: " + err);
		}
	}
}

/**
 * Deserializes a RedBlackTree from a given buffer
 * @description This deserialized the RedBlackTree defined in the sokoban library: https://github.com/Ellipsis-Labs/sokoban/tree/master
 *
 * @param buffer The buffer to deserialize
 * @param keyDeserializer The deserializer for the tree key
 * @param valueDeserializer The deserializer for the tree value
 */
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
