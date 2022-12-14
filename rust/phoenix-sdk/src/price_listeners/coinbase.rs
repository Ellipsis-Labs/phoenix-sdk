use crate::{market_event_handler::SDKMarketEvent, orderbook::Orderbook};
use coinbase_pro_rs::structs::reqs::OrderSide;
use coinbase_pro_rs::{structs::wsfeed::*, WSFeed};
use futures::StreamExt;
use phoenix_types::enums::*;
use rust_decimal::prelude::*;
use std::{
    collections::BTreeMap,
    sync::{mpsc::Sender, Arc, RwLock},
    thread,
    thread::JoinHandle,
};

pub struct CoinbasePriceListener {
    pub worker: JoinHandle<Option<()>>,
}

impl CoinbasePriceListener {
    pub fn new(market_name: String, sender: Sender<Vec<SDKMarketEvent>>) -> Self {
        let ladder = Arc::new(RwLock::new(Orderbook {
            size_mult: 1.0,
            price_mult: 1.0,
            bids: BTreeMap::new(),
            asks: BTreeMap::new(),
        }));
        let worker = thread::Builder::new()
            .name("coinbase-ladder".to_string())
            .spawn(move || Self::run(ladder, market_name, sender, false))
            .unwrap();

        Self { worker }
    }

    pub fn new_with_last_trade_price(
        market_name: String,
        sender: Sender<Vec<SDKMarketEvent>>,
    ) -> Self {
        let ladder = Arc::new(RwLock::new(Orderbook {
            size_mult: 1.0,
            price_mult: 1.0,
            bids: BTreeMap::new(),
            asks: BTreeMap::new(),
        }));
        let worker = thread::Builder::new()
            .name("coinbase-ladder".to_string())
            .spawn(move || Self::run(ladder, market_name, sender, true))
            .unwrap();

        Self { worker }
    }

    pub fn join(self) -> Option<()> {
        self.worker.join().unwrap()
    }

    pub fn run(
        ladder: Arc<RwLock<Orderbook<Decimal, f64>>>,
        market_name: String,
        sender: Sender<Vec<SDKMarketEvent>>,
        use_ticker: bool,
    ) -> Option<()> {
        let rt = tokio::runtime::Runtime::new().unwrap();

        println!("Connecting to Coinbase Websocket API");
        let coinbase_ws_url = "wss://ws-feed.pro.coinbase.com";

        loop {
            let channel_type = if use_ticker {
                ChannelType::Ticker
            } else {
                ChannelType::Level2
            };

            let mut stream = rt
                .block_on(WSFeed::connect(
                    coinbase_ws_url,
                    &[market_name.as_str()],
                    &[channel_type],
                ))
                .unwrap();

            loop {
                let msg = rt.block_on(stream.next());
                if let Some(Ok(msg)) = msg {
                    match msg {
                        Message::Level2(level2) => match level2 {
                            Level2::Snapshot { asks, bids, .. } => {
                                let mut modified_ladder = ladder.write().unwrap();
                                let update_bids = bids
                                    .iter()
                                    .map(|bid| (Decimal::from_f64(bid.price).unwrap(), bid.size))
                                    .collect::<Vec<_>>();

                                modified_ladder.update_orders(Side::Bid, update_bids);

                                let update_asks = asks
                                    .iter()
                                    .map(|ask| (Decimal::from_f64(ask.price).unwrap(), ask.size))
                                    .collect::<Vec<_>>();

                                modified_ladder.update_orders(Side::Ask, update_asks);
                            }
                            Level2::L2update { changes, .. } => {
                                let mut modified_ladder = ladder.write().unwrap();
                                for change in changes {
                                    match change.side {
                                        OrderSide::Buy => {
                                            modified_ladder.update_orders(
                                                Side::Bid,
                                                vec![(
                                                    Decimal::from_f64(change.price).unwrap(),
                                                    change.size,
                                                )],
                                            );
                                        }
                                        OrderSide::Sell => {
                                            modified_ladder.update_orders(
                                                Side::Ask,
                                                vec![(
                                                    Decimal::from_f64(change.price).unwrap(),
                                                    change.size,
                                                )],
                                            );
                                        }
                                    }
                                }
                            }
                        },
                        Message::Ticker(ticker) => {
                            let price = ticker.price();
                            if price.is_nan() || price.is_infinite() || *price <= 0.0 {
                                println!(
                                    "Price is invalid: {}, reconnecting as after 10 seconds",
                                    price
                                );
                                break;
                            }
                            match sender
                                .send(vec![SDKMarketEvent::FairPriceUpdate { price: *price }])
                            {
                                Ok(_) => {}
                                Err(e) => println!("Error while sending fair price update: {}", e),
                            }
                            continue;
                        }
                        Message::Error { message } => println!("Error: {}", message),
                        Message::InternalError(_) => panic!("internal_error"),
                        other => println!("{:?}", other),
                    };

                    let vwap = ladder.read().unwrap().vwap(3);
                    if vwap.is_nan() || vwap.is_infinite() || vwap <= 0.0 {
                        println!(
                            "Price is invalid: {}, reconnecting as after 10 seconds",
                            vwap
                        );
                        break;
                    }
                    match sender.send(vec![SDKMarketEvent::FairPriceUpdate { price: vwap }]) {
                        Ok(_) => {}
                        Err(e) => println!("Error while sending vwap update: {}", e),
                    }
                } else {
                    println!("Issue retrieving next message from Coinbase WS: {:?}", msg);
                    println!("Disconnecting for 5 seconds then reconnecting to Coinbase WS");
                    break;
                }
            }
            thread::sleep(std::time::Duration::from_secs(10));
        }
    }
}
