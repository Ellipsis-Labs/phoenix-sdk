import {
	ASSOCIATED_TOKEN_PROGRAM_ID,
	TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
	Connection,
	Keypair,
	PublicKey,
	sendAndConfirmTransaction,
} from "@solana/web3.js";
import base58 from "bs58";

import { FillSummaryEvent } from "../src/index";
import { Market } from "../src/market";
import { Side } from "../src/types";
import { toNum, getSwapTransaction, SwapOrderType } from "../src/utils";
import { getEventsFromTransaction } from "../src/events";

async function main() {
	const connection = new Connection(
		"https://qn-devnet.solana.fm/",
		"confirmed"
	);
	const marketKey = new PublicKey(
		"5iLqmcg8vifdnnw6wEpVtQxFE4Few5uiceDWzi3jvzH8"
	);

	const market = await Market.loadMarket(connection, marketKey);

	// Don't use this keypair for anything in production.
	const traderKeypair = Keypair.fromSecretKey(
		base58.decode(
			"2PKwbVQ1YMFEexCmUDyxy8cuwb69VWcvoeodZCLegqof84DJSTiEd89Ak3so9CiHycZwynesTt1JUDFAPFWEzvVs"
		)
	);

	const side = Math.random() > 0 ? Side.Ask : Side.Bid;
	const inAmount = side === Side.Ask ? 1 : 100;
	console.log(
		side === Side.Ask
			? `Selling ${inAmount} SOL`
			: `Market buy with ${inAmount} USDC`
	);

	const swapTransaction = getSwapTransaction({
		market,
		side,
		inAmount,
		trader: traderKeypair.publicKey,
	});

	const txId = await sendAndConfirmTransaction(
		connection,
		swapTransaction,
		[traderKeypair],
		{ skipPreflight: true, commitment: "confirmed" }
	);
	console.log("Transaction ID: ", txId);

	// Retry until we get the transaction. We give up after 10 tries
	let txResult = await getEventsFromTransaction(connection, txId);
	let counter = 1;
	while (txResult.instructions.length == 0) {
		txResult = await getEventsFromTransaction(connection, txId);
		counter += 1;
		if (counter == 10) {
			throw Error("Failed to fetch tranxaction");
		}
	}
	console.log("Fetched transaction after", counter, "attempt(s)");
	const fillEvents = txResult.instructions[0];

	let summary = fillEvents.events[
		fillEvents.events.length - 1
	] as FillSummaryEvent;

	if (side == Side.Bid) {
		console.log(
			"Filled",
			toNum(summary.totalBaseLotsFilled) /
				market.data.baseLotsPerBaseUnit,
			"SOL"
		);
	} else {
		console.log(
			`Sold ${inAmount} SOL for`,
			(toNum(summary.totalQuoteLotsFilled) *
				toNum(market.data.header.quoteLotSize)) /
				10 ** market.data.header.quoteParams.decimals,
			"USDC"
		);
	}
	let fees =
		(toNum(summary.totalFeeInQuoteLots) *
			toNum(market.data.header.quoteLotSize)) /
		10 ** market.data.header.quoteParams.decimals;

	console.log(`Paid $${fees} in fees:`);
}

main()
	.then((_) => {
		console.log("Done");
	})
	.catch((err) => {
		console.log(err);
	});
