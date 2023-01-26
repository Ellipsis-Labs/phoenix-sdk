import { Connection } from "@solana/web3.js";
import { WalletAdapter } from "@solana/wallet-adapter-base";

import CONFIG from "../config.json";
import { Token } from "./token";
import { Market } from "./market";

export class PhoenixClient {
	connection: Connection;
	wallet?: WalletAdapter;
	tokens: Record<string, Token>;
	markets: Record<string, Market>;

	constructor({
		connection,
		wallet,
		tokens,
		markets,
	}: {
		connection: Connection;
		wallet?: WalletAdapter;
		tokens: Record<string, Token>;
		markets: Record<string, Market>;
	}) {
		this.connection = connection;
		this.wallet = wallet;
		this.tokens = tokens;
		this.markets = markets;
	}

	/**
	 * Creates a new `PhoenixClient`
	 *
	 * @param connection The Solana `Connection` to use for the client
	 * @param wallet The `WalletAdapter` to use for submitting transactions (optional)
	 */
	async create() {
		const cluster = this.connection.rpcEndpoint.includes("devnet")
			? "devnet"
			: "mainnet-beta";
		// For every market:
		for (const marketAddress of CONFIG[cluster].markets) {
			// Load the market
			Market.loadMarket(this.connection, marketAddress).then((market) => {
				this.markets[marketAddress] = market;

				// Set the tokens from the market
				[market.baseToken, market.quoteToken].forEach((token) => {
					this.tokens[token.data.mintKey.toBase58()] = token;

					// If client provided a wallet, get the balance of the token
					if (this.wallet) {
						token
							.getTokenBalance(
								this.connection,
								this.wallet.publicKey
							)
							.then((balance) => {
								this.tokens[
									token.data.mintKey.toBase58()
								].balance = balance;
							});
					}
				});
			});
		}
	}
}
