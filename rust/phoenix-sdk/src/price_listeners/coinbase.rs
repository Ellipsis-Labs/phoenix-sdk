use crate::{market_event_handler::SDKMarketEvent, orderbook::Orderbook};
use coinbase_pro_rs::structs::reqs::OrderSide;
use coinbase_pro_rs::wsfeed::{CBSink, CBStream};
use coinbase_pro_rs::{structs::wsfeed::*, WSFeed};
use futures::StreamExt;
use phoenix_types::enums::*;
use rust_decimal::prelude::*;
use std::{
    collections::BTreeMap,
    sync::{Arc, RwLock},
};
use tokio::sync::mpsc::Sender;

pub struct CoinbasePriceListener {
    ladder: Arc<RwLock<Orderbook<Decimal, f64>>>,
    market_name: String,
    sender: Sender<Vec<SDKMarketEvent>>,
    use_ticker: bool,
}

impl CoinbasePriceListener {
    pub fn new(market_name: String, sender: Sender<Vec<SDKMarketEvent>>) -> Self {
        let ladder = Arc::new(RwLock::new(Orderbook {
            size_mult: 1.0,
            price_mult: 1.0,
            bids: BTreeMap::new(),
            asks: BTreeMap::new(),
        }));

        Self {
            ladder,
            market_name,
            sender,
            use_ticker: false,
        }
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

        Self {
            ladder,
            market_name,
            sender,
            use_ticker: true,
        }
    }

    pub async fn run(&self) {
        println!("Connecting to Coinbase Websocket API");
        let coinbase_ws_url = "wss://ws-feed.pro.coinbase.com";

        loop {
            let channel_type = if self.use_ticker {
                ChannelType::Ticker
            } else {
                ChannelType::Level2
            };

            let mut stream = WSFeed::connect(
                coinbase_ws_url,
                &[self.market_name.as_str()],
                &[channel_type],
            )
            .await
            .unwrap();

            Self::run_listener(&mut stream, self.ladder.clone(), self.sender.clone()).await;
            tokio::time::sleep(tokio::time::Duration::from_secs(10)).await;
        }
    }

    async fn run_listener(
        stream: &mut (impl CBStream + CBSink),
        ladder: Arc<RwLock<Orderbook<Decimal, f64>>>,
        sender: Sender<Vec<SDKMarketEvent>>,
    ) {
        loop {
            // let event = rt.block_on(stream.next());
            let event = stream.next().await;
            let msg = if let Some(Ok(msg)) = event {
                msg
            } else {
                println!(
                    "Issue retrieving next message from Coinbase WS: {:?}",
                    event
                );
                println!("Disconnecting for 5 seconds then reconnecting to Coinbase WS");
                break;
            };
            match msg {
                Message::Level2(level2) => match level2 {
                    Level2::Snapshot { asks, bids, .. } => {
                        let mut modified_ladder = ladder.write().unwrap();
                        let mut response_ok = true;
                        let update_bids = bids
                            .iter()
                            .filter_map(|bid| {
                                if bid.price.is_nan() || bid.price.is_infinite() || bid.price <= 0.0
                                {
                                    response_ok = false;
                                    None
                                } else {
                                    Some((
                                        Decimal::from_f64(bid.price).map_or_else(
                                            || {
                                                response_ok = false;
                                                None
                                            },
                                            Some,
                                        )?,
                                        bid.size,
                                    ))
                                }
                            })
                            .collect::<Vec<_>>();

                        modified_ladder.update_orders(Side::Bid, update_bids);

                        let update_asks = asks
                            .iter()
                            .filter_map(|ask| {
                                if ask.price.is_nan() || ask.price.is_infinite() || ask.price <= 0.0
                                {
                                    response_ok = false;
                                    None
                                } else {
                                    Some((
                                        Decimal::from_f64(ask.price).map_or_else(
                                            || {
                                                response_ok = false;
                                                None
                                            },
                                            Some,
                                        )?,
                                        ask.size,
                                    ))
                                }
                            })
                            .collect::<Vec<_>>();

                        modified_ladder.update_orders(Side::Ask, update_asks);
                        if !response_ok {
                            println!("Response is invalid, bids: {:?}, asks {:?}", bids, asks);
                            break;
                        }
                    }
                    Level2::L2update { changes, .. } => {
                        let mut modified_ladder = ladder.write().unwrap();
                        for change in changes {
                            if change.price.is_nan()
                                || change.price.is_infinite()
                                || change.price <= 0.0
                            {
                                println!("Invalid price: {:?}", change.price);
                                break;
                            }
                            let decimal_price = match Decimal::from_f64(change.price) {
                                None => {
                                    println!("Invalid price: {:?}", change.price);
                                    break;
                                }
                                Some(p) => p,
                            };
                            match change.side {
                                OrderSide::Buy => {
                                    modified_ladder.update_orders(
                                        Side::Bid,
                                        vec![(decimal_price, change.size)],
                                    );
                                }
                                OrderSide::Sell => {
                                    modified_ladder.update_orders(
                                        Side::Ask,
                                        vec![(decimal_price, change.size)],
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
                        return;
                    }
                    match sender
                        .send(vec![SDKMarketEvent::FairPriceUpdate { price: *price }])
                        .await
                    {
                        Ok(_) => {}
                        Err(e) => println!("Error while sending fair price update: {}", e),
                    }
                    continue;
                }
                Message::Error { message } => {
                    println!("Error: {}", message);
                    continue;
                }
                Message::InternalError(_) => panic!("internal_error"),
                other => {
                    println!("Received other message {:?}", other);
                    continue;
                }
            };

            let vwap = ladder.read().unwrap().vwap(3);
            if vwap.is_nan() || vwap.is_infinite() || vwap <= 0.0 {
                println!(
                    "Price is invalid: {}, reconnecting as after 10 seconds",
                    vwap
                );
                return;
            }
            match sender
                .send(vec![SDKMarketEvent::FairPriceUpdate { price: vwap }])
                .await
            {
                Ok(_) => {}
                Err(e) => println!("Error while sending vwap update: {}", e),
            }
        }
    }
}
