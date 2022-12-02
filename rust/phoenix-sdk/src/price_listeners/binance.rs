use crate::{market_event_handler::SDKMarketEvent, orderbook::Orderbook};
use binance::{api::Binance, market::Market, websockets::*};
use phoenix_types::enums::*;
use rust_decimal::prelude::*;
use std::{
    collections::BTreeMap,
    sync::{atomic::AtomicBool, mpsc::Sender, Arc, RwLock},
    thread,
    thread::JoinHandle,
};

pub struct BinancePriceListener {
    pub worker: JoinHandle<Option<()>>,
}

impl BinancePriceListener {
    pub fn new(market_name: String, sender: Sender<Vec<SDKMarketEvent>>) -> Self {
        let ladder = Arc::new(RwLock::new(Orderbook {
            size_mult: 1.0,
            price_mult: 1.0,
            bids: BTreeMap::new(),
            asks: BTreeMap::new(),
        }));
        let worker = thread::Builder::new()
            .name("binance-ladder".to_string())
            .spawn(move || Self::run(ladder, market_name, sender))
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
    ) -> Option<()> {
        println!("Connecting to Binance Websocket API");

        let market: Market = Binance::new(None, None);
        let symbols: Vec<_> = vec![market_name].into_iter().map(String::from).collect();

        let mut endpoints: Vec<String> = Vec::new();
        for symbol in symbols.iter() {
            match market.get_depth(symbol) {
                Ok(msg) => {
                    let mut modified_ladder = ladder.write().ok()?;
                    let bids = msg
                        .bids
                        .iter()
                        .map(|b| (Decimal::from_f64(b.price).unwrap(), b.qty))
                        .collect::<Vec<_>>();
                    modified_ladder.update_orders(Side::Bid, bids);

                    let asks = msg
                        .asks
                        .iter()
                        .map(|a| (Decimal::from_f64(a.price).unwrap(), a.qty))
                        .collect::<Vec<_>>();
                    modified_ladder.update_orders(Side::Ask, asks);
                }
                Err(e) => println!("Error: {}", e),
            }
            endpoints.push(format!("{}@depth@100ms", symbol.to_lowercase()));
        }
        println!("alive {:?}", endpoints);
        let mut web_socket: WebSockets<'_> = WebSockets::new(|event: WebsocketEvent| {
            if let WebsocketEvent::DepthOrderBook(depth_order_book) = event {
                let mut modified_ladder = ladder
                    .write()
                    .map_err(|e| format!("Error writing to ladder: {e}"))?;
                modified_ladder.update_orders(
                    Side::Bid,
                    depth_order_book
                        .bids
                        .iter()
                        .map(|b| (Decimal::from_f64(b.price).unwrap(), b.qty))
                        .collect::<Vec<_>>(),
                );
                modified_ladder.update_orders(
                    Side::Ask,
                    depth_order_book
                        .asks
                        .iter()
                        .map(|a| (Decimal::from_f64(a.price).unwrap(), a.qty))
                        .collect::<Vec<_>>(),
                );
            }
            let vwap = ladder
                .read()
                .map_err(|e| format!("Error reading from ladder: {e}"))?
                .vwap(3);
            match sender.send(vec![SDKMarketEvent::FairPriceUpdate { price: vwap }]) {
                Ok(_) => {}
                Err(e) => println!("Error while sending fair price update: {}", e),
            }
            Ok(())
        });

        let keep_running = AtomicBool::new(true);
        web_socket.connect_multiple_streams(&endpoints).ok()?; // check error
        if let Err(e) = web_socket.event_loop(&keep_running) {
            println!("Binance Error: {:?}", e);
        }
        web_socket.disconnect().ok()?;
        Some(())
    }
}
