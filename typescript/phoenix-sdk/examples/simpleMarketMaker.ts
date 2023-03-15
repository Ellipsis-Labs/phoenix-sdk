import {
  Connection,
  PublicKey,
  Keypair,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as Phoenix from "../src";
import fs from "fs";

// Ex: ts-node examples/simpleMarketMaker.ts {private_key_path}
export async function simpleMarketMaker(privateKeyPath: string) {
  // mainnet test market (BASE/QUOTE)
  const marketPubkey = new PublicKey(
    "3MZskhKUdNRkeMQ6zyNVSJcCx38o79ohwmSgZ2d5a4cu"
  );
  // use custom RPC for better performance
  const connection = new Connection("http://127.0.0.1:8899");
  let blockhash;

  // Frequency in milliseconds to update quotes
  const QUOTE_REFRESH_FREQUENCY = 10000;

  // Edge in cents on quote. Places bid/ask at fair price -/+ edge
  const QUOTE_EDGE = 0.01;

  // Expected life time of order in seconds
  const ORDER_LIFETIME_IN_SECONDS = 7;

  // Create a Phoenix client
  const client = await Phoenix.Client.createWithMarketAddresses(
    connection,
    "mainnet",
    [marketPubkey]
  );

  const market = client.markets.get(marketPubkey.toString());
  const marketData = market?.data;
  if (!marketData) {
    throw new Error("Market data not found");
  }

  // load in keypair for the trader you wish to trade with (must have funds in the market)
  const privateKey = JSON.parse(fs.readFileSync(privateKeyPath, "utf-8"));
  const trader = Keypair.fromSeed(Uint8Array.from(privateKey.slice(0, 32)));

  // grab relevant accounts needed for sending instructions
  const baseAccount = client.getBaseAccountKey(
    trader.publicKey,
    marketPubkey.toString()
  );
  const quoteAccount = client.getQuoteAccountKey(
    trader.publicKey,
    marketPubkey.toString()
  );
  const seat = client.getSeatKey(trader.publicKey, marketPubkey.toString());
  const logAuthority = client.getLogAuthority();

  // create account object for each instruction
  const placeAccounts: Phoenix.PlaceLimitOrderInstructionAccounts = {
    phoenixProgram: Phoenix.PROGRAM_ID,
    logAuthority: logAuthority,
    market: marketPubkey,
    trader: trader.publicKey,
    seat: seat,
    baseAccount: baseAccount,
    quoteAccount: quoteAccount,
    quoteVault: marketData.header.quoteParams.vaultKey,
    baseVault: marketData.header.baseParams.vaultKey,
    tokenProgram: TOKEN_PROGRAM_ID,
  };

  //unused in this script, but example of accounts needed for withdraw
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const withdrawAccounts: Phoenix.WithdrawFundsInstructionAccounts = {
    phoenixProgram: Phoenix.PROGRAM_ID,
    logAuthority: logAuthority,
    market: marketPubkey,
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
    marketPubkey.toString(),
    trader.publicKey
  );

  let count = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const cancelAll = Phoenix.createCancelAllOrdersInstructionWithClient(
      client,
      marketPubkey.toString(),
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
        instructions: [cancelAll],
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
    const price = await fetch("https://api.coinbase.com/v2/prices/SOL-USD/spot")
      .then((response) => response.json())
      .then((data) => {
        return data.data.amount;
      })
      .catch((error) => console.error(error));
    console.log("price", price);
    const bidPrice = parseFloat(price) - QUOTE_EDGE;
    const askPrice = parseFloat(price) + QUOTE_EDGE;

    // Get current time in seconds
    const currentTime = Math.floor(Date.now() / 1000);

    // create bid and ask instructions for 1 SOL
    const bidOrderPacket: Phoenix.OrderPacket = {
      __kind: "PostOnly",
      side: Phoenix.Side.Bid,
      priceInTicks: Phoenix.toBN(
        client.floatPriceToTicks(bidPrice, marketPubkey.toString())
      ),
      numBaseLots: Phoenix.toBN(
        client.rawBaseUnitsToBaseLotsRoundedDown(1, marketPubkey.toString())
      ),
      clientOrderId: Phoenix.toBN(1),
      rejectPostOnly: false,
      useOnlyDepositedFunds: false,
      lastValidSlot: null,
      lastValidUnixTimestampInSeconds: currentTime + ORDER_LIFETIME_IN_SECONDS,
    };
    const placeBuy = Phoenix.createPlaceLimitOrderInstruction(placeAccounts, {
      orderPacket: bidOrderPacket,
    });

    const askOrderPacket: Phoenix.OrderPacket = {
      __kind: "PostOnly",
      side: Phoenix.Side.Ask,
      priceInTicks: Phoenix.toBN(
        client.floatPriceToTicks(askPrice, marketPubkey.toString())
      ),
      numBaseLots: Phoenix.toBN(
        client.rawBaseUnitsToBaseLotsRoundedDown(1, marketPubkey.toString())
      ),
      clientOrderId: Phoenix.toBN(2),
      rejectPostOnly: false,
      useOnlyDepositedFunds: false,
      lastValidSlot: null,
      lastValidUnixTimestampInSeconds: currentTime + ORDER_LIFETIME_IN_SECONDS,
    };

    const placeAsk = Phoenix.createPlaceLimitOrderInstructionWithClient(
      client,
      {
        orderPacket: askOrderPacket,
      },
      marketPubkey.toString(),
      trader.publicKey
    );

    const instructions = [placeBuy, placeAsk];
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

      const placeQuotesMessage = new TransactionMessage({
        payerKey: trader.publicKey,
        recentBlockhash: blockhash,
        instructions: instructions,
      }).compileToV0Message();

      const placeQuotesTx = new VersionedTransaction(placeQuotesMessage);
      placeQuotesTx.sign([trader]);

      const placeQuotesTxid = await connection.sendTransaction(placeQuotesTx);
      console.log(
        "place quotes",
        bidPrice.toFixed(market.getPriceDecimalPlaces()),
        "@",
        askPrice.toFixed(market.getPriceDecimalPlaces()),
        "txid",
        placeQuotesTxid
      );
    } catch (err) {
      console.log("Error: ", err);
      continue;
    }

    // refresh quotes every X milliseconds
    await new Promise((r) => setTimeout(r, QUOTE_REFRESH_FREQUENCY));
  }
}

(async function () {
  try {
    await simpleMarketMaker(process.argv[2]);
  } catch (err) {
    console.log("Error: ", err);
    process.exit(1);
  }

  process.exit(0);
})();
