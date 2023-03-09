import {
  Connection,
  PublicKey,
  Keypair,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import * as Phoenix from "../src";
const axios = require("axios");

// Ex: ts-node examples/simple_market_maker.ts
export async function simple_market_maker() {
  // mainnet test market (BASE/QUOTE)
  let market_pubkey = new PublicKey(
    "14CAwu3LiBBk5fcHGdTsFyVxDwvpgFiSfDwgPJxECcE5"
  );
  // use custom RPC for better performance
  const connection = new Connection("https://api.mainnet-beta.solana.com");

  let blockhash;

  // Frequency in milliseconds to update quotes
  const QuoteRefreshFrequency = 10000;

  // Edge in cents on quote. Places bid/ask at fair price -/+ edge
  const QuoteEdge = 0.01;

  const market = await Phoenix.Market.load({
    connection: connection,
    address: market_pubkey,
  });
  const marketData = market.data;
  // load in keypair for the trader you wish to trade with (must have funds in the market)
  const trader = Keypair.fromSeed(
    Uint8Array.from(
      [
        // add keypair seed here
      ].slice(0, 32)
    )
  );
  // Create a Phoenix client
  let client = await Phoenix.Client.create(connection, "mainnet");

  // grab relevant accounts needed for sending instructions
  const baseAccount = client.getBaseAccountKey(
    trader.publicKey,
    market_pubkey.toString()
  );
  const quoteAccount = client.getQuoteAccountKey(
    trader.publicKey,
    market_pubkey.toString()
  );
  const seat = client.getSeatKey(trader.publicKey, market_pubkey.toString());
  const logAuthority = client.getLogAuthority();

  // create account object for each instruction
  const placeAccounts: Phoenix.PlaceLimitOrderInstructionAccounts = {
    phoenixProgram: Phoenix.PROGRAM_ID,
    logAuthority: logAuthority,
    market: market_pubkey,
    trader: trader.publicKey,
    seat: seat,
    baseAccount: baseAccount,
    quoteAccount: quoteAccount,
    quoteVault: marketData.header.quoteParams.vaultKey,
    baseVault: marketData.header.baseParams.vaultKey,
    tokenProgram: TOKEN_PROGRAM_ID,
  };

  //unused in this script, but example of accounts needed for withdraw
  const withdrawAccounts: Phoenix.WithdrawFundsInstructionAccounts = {
    phoenixProgram: Phoenix.PROGRAM_ID,
    logAuthority: logAuthority,
    market: market_pubkey,
    trader: trader.publicKey,
    baseAccount: baseAccount,
    quoteAccount: quoteAccount,
    baseVault: marketData.header.baseParams.vaultKey,
    quoteVault: marketData.header.quoteParams.vaultKey,
    tokenProgram: TOKEN_PROGRAM_ID,
  };

  // Setting params to null will withdraw all funds
  const withdrawParams: Phoenix.WithdrawParams = {
    quoteLotsToWithdraw: null,
    baseLotsToWithdraw: null,
  };

  const placeWithdraw = Phoenix.createWithdrawFundsInstructionWithClient(
    client,
    {
      withdrawFundsParams: withdrawParams,
    },
    market_pubkey.toString(),
    trader.publicKey
  );

  let count = 0;
  while (true) {
    let cancel_all = Phoenix.createCancelAllOrdersInstructionWithClient(
      client,
      market_pubkey.toString(),
      trader.publicKey
    );

    // Send cancel all transaction.
    // Note we could bundle this with the place order transaction below, but we choose to cancel 
    // seperately since getting the price could take an undeterministic amount of time
    try {
      blockhash = await connection
        .getLatestBlockhash()
        .then((res) => res.blockhash);

      const messageV0 = new TransactionMessage({
        payerKey: trader.publicKey,
        recentBlockhash: blockhash,
        instructions: [cancel_all],
      }).compileToV0Message();

      const transaction = new VersionedTransaction(messageV0);
      transaction.sign([trader]);

      const txid = await connection.sendTransaction(transaction);

      console.log("Cancel txid:", txid);
    } catch (err) {
      console.log("Error: ", err);
      continue;
    }

    // grab the price from coinbase
    let price = await axios
      .get("https://api.coinbase.com/v2/prices/SOL-USD/spot")
      .then((response) => response.data)
      .then((data) => {
        return data.data.amount;
      })
      .catch((error) => console.error(error));
    console.log("price", price);
    let bid_price = parseFloat(price) - QuoteEdge;
    let ask_price = parseFloat(price) + QuoteEdge;

    // create bid and ask instructions for 1 SOL
    const bidOrderPacket: Phoenix.OrderPacket = {
      __kind: "PostOnly",
      side: Phoenix.Side.Bid,
      priceInTicks: Phoenix.toBN(
        client.floatPriceToTicks(bid_price, market_pubkey.toString())
      ),
      numBaseLots: Phoenix.toBN(
        client.rawBaseUnitsToBaseLots(1, market_pubkey.toString())
      ),
      clientOrderId: Phoenix.toBN(1),
      rejectPostOnly: false,
      useOnlyDepositedFunds: false,
    };
    const placeBuy = Phoenix.createPlaceLimitOrderInstruction(placeAccounts, {
      orderPacket: bidOrderPacket,
    });

    const askOrderPacket: Phoenix.OrderPacket = {
      __kind: "PostOnly",
      side: Phoenix.Side.Ask,
      priceInTicks: Phoenix.toBN(
        client.floatPriceToTicks(ask_price, market_pubkey.toString())
      ),
      numBaseLots: Phoenix.toBN(
        client.rawBaseUnitsToBaseLots(1, market_pubkey.toString())
      ),
      clientOrderId: Phoenix.toBN(2),
      rejectPostOnly: false,
      useOnlyDepositedFunds: false,
    };

    const placeAsk = Phoenix.createPlaceLimitOrderInstructionWithClient(
      client,
      {
        orderPacket: askOrderPacket,
      },
      market_pubkey.toString(),
      trader.publicKey
    );

    let instructions = [placeBuy, placeAsk];
    //every 5th iteration, add a withdraw funds instruction
    if (count == 5) {
      instructions.push(placeWithdraw);
      count = 0;
    } else {
      count++;
    }

    // Send place orders/withdraw transaction 
    try {
      blockhash = await connection
        .getLatestBlockhash()
        .then((res) => res.blockhash);

      let place_quotes_message = new TransactionMessage({
        payerKey: trader.publicKey,
        recentBlockhash: blockhash,
        instructions: instructions,
      }).compileToV0Message();

      const place_quotes_tx = new VersionedTransaction(place_quotes_message);
      place_quotes_tx.sign([trader]);

      const place_quotes_txid = await connection.sendTransaction(
        place_quotes_tx
      );
      console.log(
        "place quotes",
        bid_price.toFixed(market.getPriceDecimalPlaces()),
        "@",
        ask_price.toFixed(market.getPriceDecimalPlaces()),
        "txid",
        place_quotes_txid
      );
    } catch (err) {
      console.log("Error: ", err);
      continue;
    }

    // refresh quotes every X milliseconds
    await new Promise((r) => setTimeout(r, QuoteRefreshFrequency));
  }
}

(async function () {
  try {
    await simple_market_maker();
  } catch (err) {
    console.log("Error: ", err);
    process.exit(1);
  }

  process.exit(0);
})();
