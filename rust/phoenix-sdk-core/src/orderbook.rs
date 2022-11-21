use std::collections::BTreeMap;

use itertools::Itertools;
use num_traits::ToPrimitive;
use phoenix_types::enums::Side;
use phoenix_types::market::FIFOOrderId;
use rust_decimal::Decimal;

use crate::sdk_client_core::PhoenixOrder;

pub trait OrderbookKey {
    fn price(&self) -> f64;
}

pub trait OrderbookValue {
    fn size(&self) -> f64;
}

impl OrderbookKey for FIFOOrderId {
    fn price(&self) -> f64 {
        self.num_quote_ticks_per_base_unit.to_f64().unwrap()
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

pub struct Orderbook<K: Ord + OrderbookKey + Copy, V: OrderbookValue + Copy> {
    pub size_mult: f64,
    pub price_mult: f64,
    pub bids: BTreeMap<K, V>,
    pub asks: BTreeMap<K, V>,
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
            .group_by(|(price, _)| price.price() * self.price_mult)
            .into_iter()
            .map(|(price, group)| {
                let size = group.map(|(_, size)| size.size()).sum::<f64>() * self.size_mult;
                (price, size)
            })
            .take(levels)
            .collect::<Vec<_>>();
        let bids = self
            .get_bids()
            .iter()
            .rev()
            .group_by(|(price, _)| price.price() * self.price_mult)
            .into_iter()
            .map(|(price, group)| {
                let size = group.map(|(_, size)| size.size()).sum::<f64>() * self.size_mult;
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
                let key = if let Some(order) = match side {
                    Side::Bid => opposite_book.first_entry(), // Smallest ask
                    Side::Ask => opposite_book.last_entry(),  // Largest bid
                } {
                    // We use the sign to determine whether the order crosses the book
                    let sign = 2.0 * (side == Side::Bid) as u64 as f64 - 1.0; // 1 for bid, -1 for ask
                    if price.price() * sign >= order.key().price() * sign {
                        *order.key()
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
        num / (denom * self.price_mult)
    }
}
