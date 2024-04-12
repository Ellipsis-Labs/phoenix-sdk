use std::collections::BTreeMap;

use itertools::Itertools;
use num_traits::ToPrimitive;
use phoenix::quantities::WrapperU64;
use phoenix::state::enums::Side;
use phoenix::state::markets::{FIFOOrderId, FIFORestingOrder, Market};
use phoenix::state::OrderPacket;
use rust_decimal::Decimal;
use solana_sdk::pubkey::Pubkey;

use crate::sdk_client_core::PhoenixOrder;

pub trait OrderbookKey {
    fn price(&self) -> f64;
}

pub trait OrderbookValue {
    fn size(&self) -> f64;
}

impl OrderbookKey for FIFOOrderId {
    fn price(&self) -> f64 {
        self.price_in_ticks.as_u64().to_f64().unwrap()
    }
}

impl OrderbookKey for u64 {
    fn price(&self) -> f64 {
        self.to_f64().unwrap()
    }
}

impl OrderbookKey for f64 {
    fn price(&self) -> f64 {
        self.to_f64().unwrap()
    }
}

impl OrderbookKey for Decimal {
    fn price(&self) -> f64 {
        self.to_f64().unwrap()
    }
}

impl OrderbookValue for PhoenixOrder {
    fn size(&self) -> f64 {
        self.num_base_lots.to_f64().unwrap()
    }
}

impl OrderbookValue for u64 {
    fn size(&self) -> f64 {
        self.to_f64().unwrap()
    }
}

impl OrderbookValue for f64 {
    fn size(&self) -> f64 {
        self.to_f64().unwrap()
    }
}

impl OrderbookValue for Decimal {
    fn size(&self) -> f64 {
        self.to_f64().unwrap()
    }
}

#[derive(Debug, Clone, Default)]
pub struct Orderbook<K: Ord + OrderbookKey + Copy, V: OrderbookValue + Copy> {
    pub raw_base_units_per_base_lot: f64,
    pub quote_units_per_raw_base_unit_per_tick: f64,
    pub bids: BTreeMap<K, V>,
    pub asks: BTreeMap<K, V>,
}

impl Orderbook<FIFOOrderId, PhoenixOrder> {
    pub fn from_market(
        market: &dyn Market<Pubkey, FIFOOrderId, FIFORestingOrder, OrderPacket>,
        raw_base_units_per_base_lot: f64,
        quote_units_per_raw_base_unit_per_tick: f64,
    ) -> Self {
        let traders = market
            .get_registered_traders()
            .iter()
            .map(|(trader, _)| *trader)
            .collect::<Vec<_>>();

        let mut index_to_trader = BTreeMap::new();
        for trader in traders.iter() {
            let index = market.get_trader_index(trader).unwrap();
            index_to_trader.insert(index as u64, *trader);
        }

        let mut orderbook = Orderbook {
            raw_base_units_per_base_lot,
            quote_units_per_raw_base_unit_per_tick,
            bids: BTreeMap::new(),
            asks: BTreeMap::new(),
        };
        for side in [Side::Bid, Side::Ask].iter() {
            orderbook.update_orders(
                *side,
                market
                    .get_book(*side)
                    .iter()
                    .map(
                        |(
                            &k,
                            &FIFORestingOrder {
                                trader_index,
                                num_base_lots,
                                ..
                            },
                        )| {
                            (
                                k,
                                PhoenixOrder {
                                    num_base_lots: num_base_lots.as_u64(),
                                    maker_id: index_to_trader[&trader_index],
                                },
                            )
                        },
                    )
                    .collect::<Vec<_>>(),
            );
        }
        orderbook
    }
}

impl<K: Ord + OrderbookKey + Copy, V: OrderbookValue + Copy> Orderbook<K, V> {
    pub fn get_bids(&self) -> Vec<(K, V)> {
        self.bids
            .iter()
            .rev()
            .map(|(&price, &size)| (price, size))
            .collect::<Vec<_>>()
    }

    pub fn get_asks(&self) -> Vec<(K, V)> {
        self.asks
            .iter()
            .map(|(&price, &size)| (price, size))
            .collect::<Vec<_>>()
    }

    pub fn print_ladder(&self, levels: usize, precision: usize) {
        #[allow(clippy::needless_collect)]
        let asks = self
            .get_asks()
            .iter()
            .group_by(|(price, _)| price.price() * self.quote_units_per_raw_base_unit_per_tick)
            .into_iter()
            .map(|(price, group)| {
                let size = group.map(|(_, size)| size.size()).sum::<f64>()
                    * self.raw_base_units_per_base_lot;
                (price, size)
            })
            .take(levels)
            .collect::<Vec<_>>();
        let bids = self
            .get_bids()
            .iter()
            .rev()
            .group_by(|(price, _)| price.price() * self.quote_units_per_raw_base_unit_per_tick)
            .into_iter()
            .map(|(price, group)| {
                let size = group.map(|(_, size)| size.size()).sum::<f64>()
                    * self.raw_base_units_per_base_lot;
                (price, size)
            })
            .take(levels)
            .collect::<Vec<_>>();

        let width: usize = 10;

        for (ask_price, ask_size) in asks.into_iter().rev() {
            let p = format!("{:.1$}", ask_price, precision);
            let s = format!("{:.1$}", ask_size, precision);
            let str = format!("{:width$} {:^width$} {:<width$}", "", p, s);
            println!("{}", str);
        }
        for (bid_price, bid_size) in bids {
            let p = format!("{:.1$}", bid_price, precision);
            let s = format!("{:.1$}", bid_size, precision);
            let str = format!("{:>width$} {:^width$} {:width$}", s, p, "");
            println!("{}", str);
        }
    }

    #[allow(clippy::while_let_loop)]
    pub fn update_orders(&mut self, side: Side, orders: Vec<(K, V)>) {
        let (book, opposite_book) = match side {
            Side::Bid => (&mut self.bids, &mut self.asks),
            Side::Ask => (&mut self.asks, &mut self.bids),
        };
        for (price, qty) in orders {
            if qty.size() == 0.0 {
                book.remove(&price);
                continue;
            } else {
                book.insert(price, qty);
            }
            loop {
                let key = if let Some((key, _)) = match side {
                    Side::Bid => opposite_book.iter().next(), // Smallest ask
                    Side::Ask => opposite_book.iter().rev().next(), // Largest bid
                } {
                    // We use the sign to determine whether the order crosses the book
                    let sign = 2.0 * (side == Side::Bid) as u64 as f64 - 1.0; // 1 for bid, -1 for ask
                    if price.price() * sign >= key.price() * sign {
                        *key
                    } else {
                        break;
                    }
                } else {
                    break;
                };
                opposite_book.remove(&key);
            }
        }
    }

    pub fn process_book_update(&mut self, side: Side, price: K, lots_remaining: V) {
        self.update_orders(side, vec![(price, lots_remaining)]);
    }

    pub fn process_trade(&mut self, side: Side, price: K, lots_remaining: V) {
        self.update_orders(side, vec![(price, lots_remaining)]);
    }

    pub fn vwap(&self, levels: usize) -> f64 {
        let bids: Vec<_> = self.get_bids();
        let asks: Vec<_> = self.get_asks();
        let denom = bids
            .iter()
            .take(levels)
            .zip(asks.iter().take(levels))
            .map(|((_, bid_resting_order), (_, ask_resting_order))| {
                ask_resting_order.size() + bid_resting_order.size()
            })
            .sum::<f64>();
        let num = bids
            .iter()
            .take(levels)
            .zip(asks.iter().take(levels))
            .map(
                |((bid_order_id, bid_resting_order), (ask_order_id, ask_resting_order))| {
                    (ask_resting_order.size() * bid_order_id.price())
                        + (bid_resting_order.size() * ask_order_id.price())
                },
            )
            .sum::<f64>();
        num / (denom * self.quote_units_per_raw_base_unit_per_tick)
    }
}
