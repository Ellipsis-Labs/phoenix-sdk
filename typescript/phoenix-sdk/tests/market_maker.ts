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

// Ex: ts-node tests/market_maker.ts
export async function market_maker() {

  // mainnet test market (BASE/QUOTE)
  let market_pubkey = new PublicKey(
    "14CAwu3LiBBk5fcHGdTsFyVxDwvpgFiSfDwgPJxECcE5"
  );

  const connection = new Connection(
    "https://cosmological-green-log.solana-mainnet.discover.quiknode.pro/906e9385519bc5964363cafc94b6f9eed430ae8e"
  );
  const market = await Phoenix.Market.load({
    connection: connection,
    address: market_pubkey,
  });
  const marketData = market.data;
  const trader = Keypair.fromSeed( 
    Uint8Array.from(
      [
        // insert mainnet key here
      ].slice(0, 32)
    )
  );

  let client = await Phoenix.Client.create(connection, "mainnet");

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

  const place_accounts: Phoenix.PlaceLimitOrderInstructionAccounts = {
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

  //unused variable but example of accounts needed for withdraw
  const withdraw_accounts: Phoenix.WithdrawFundsInstructionAccounts = {
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

  const withdrawParams: Phoenix.WithdrawParams = {
    quoteLotsToWithdraw: null,
    baseLotsToWithdraw: null,
  };

  const place_withdraw = Phoenix.createWithdrawFundsInstructionWithClient(
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
    let blockhash = await connection
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
    console.log("cancel txid", txid);
    let price = await axios
      .get("https://api.coinbase.com/v2/prices/SOL-USD/spot")
      .then((response) => response.data)
      .then((data) => {
        return data.data.amount;
      })
      .catch((error) => console.error(error));
    console.log("price", price);
    let bid_price = parseFloat(price) - 0.01;
    let ask_price = parseFloat(price) + 0.01;

    const bid_orderPacket: Phoenix.OrderPacket = {
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
    const place_buy = Phoenix.createPlaceLimitOrderInstruction(place_accounts, {
      orderPacket: bid_orderPacket,
    });

    const ask_orderPacket: Phoenix.OrderPacket = {
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

    const place_ask = Phoenix.createPlaceLimitOrderInstructionWithClient(
      client,
      {
        orderPacket: ask_orderPacket,
      },
      market_pubkey.toString(),
      trader.publicKey
    );

    blockhash = await connection
      .getLatestBlockhash()
      .then((res) => res.blockhash);

    let instructions = [place_buy, place_ask];
    if (count == 5) {
      instructions.push(place_withdraw);
      count = 0;
    } else {
      count++;
    }
    let place_quotes_message = new TransactionMessage({
      payerKey: trader.publicKey,
      recentBlockhash: blockhash,
      instructions: instructions,
    }).compileToV0Message();

    const place_quotes_tx = new VersionedTransaction(place_quotes_message);
    place_quotes_tx.sign([trader]);

    const place_quotes_txid = await connection.sendTransaction(place_quotes_tx);
    console.log(
      "place quotes",
      bid_price.toFixed(market.getPriceDecimalPlaces()),
      "@",
      ask_price.toFixed(market.getPriceDecimalPlaces()),
      "txid",
      place_quotes_txid
    );

    await new Promise((r) => setTimeout(r, 10000));
  }
}

(async function () {
  try {
    await market_maker();
  } catch (err) {
    console.log("Error: ", err);
    process.exit(1);
  }

  process.exit(0);
})();
