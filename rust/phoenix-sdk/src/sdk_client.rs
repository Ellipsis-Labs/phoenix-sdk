use borsh::{BorshDeserialize, BorshSerialize};
use ellipsis_client::EllipsisClient;
pub use phoenix_sdk_core::sdk_client_core::PhoenixOrder;
use phoenix_types as phoenix;
use phoenix_types::dispatch::*;
use phoenix_types::enums::*;
use phoenix_types::events::*;
use phoenix_types::instructions::*;
use phoenix_types::market::*;
use phoenix_types::order_packet::*;
use rand::{rngs::StdRng, Rng, SeedableRng};
use solana_client::rpc_client::RpcClient;
use solana_program::instruction::Instruction;
use solana_sdk::{
    commitment_config::CommitmentConfig,
    program_pack::Pack,
    pubkey::Pubkey,
    signature::{Signature, Signer},
    signer::keypair::Keypair,
};
use std::fmt::Display;
use std::ops::Div;
use std::ops::Rem;
use std::sync::Mutex;
use std::{collections::BTreeMap, mem::size_of, sync::Arc};

use crate::market_event_handler::{
    Evict, Fill, FillSummary, MarketEventDetails, PhoenixEvent, Place, Reduce,
};
use crate::orderbook::Orderbook;

const AUDIT_LOG_HEADER_LEN: usize = 92;

pub fn get_decimal_string<N: Display + Div + Rem + Copy + TryFrom<u64>>(
    amount: N,
    decimals: u32,
) -> String
where
    <N as Rem>::Output: std::fmt::Display,
    <N as Div>::Output: std::fmt::Display,
    <N as TryFrom<u64>>::Error: std::fmt::Debug,
{
    let scale = N::try_from(10_u64.pow(decimals)).unwrap();
    let lhs = amount / scale;
    let rhs = format!("{:0width$}", (amount % scale), width = decimals as usize).replace('-', ""); // remove negative sign from rhs
    format!("{}.{}", lhs, rhs)
}

#[derive(Debug, Copy, Clone, BorshDeserialize, BorshSerialize)]
pub enum MarketEventWrapper {
    Uninitialized,
    Header,
    Fill,
    Place,
    Reduce,
    Evict,
    FillSummary,
}

#[derive(Clone, Copy, Debug)]
pub struct MarketMetadata {
    pub base_mint: Pubkey,
    pub quote_mint: Pubkey,
    pub base_decimals: u32,
    pub quote_decimals: u32,
    /// 10^base_decimals
    pub base_multiplier: u64,
    /// 10^quote_decimals
    pub quote_multiplier: u64,
    pub quote_lot_size: u64,
    pub base_lot_size: u64,
    pub tick_size: u64,
    pub num_base_lots_per_base_unit: u64,
    pub num_quote_lots_per_tick: u64,
}

pub struct SDKClient {
    pub markets: BTreeMap<Pubkey, MarketMetadata>,
    pub rng: Arc<Mutex<StdRng>>,
    pub active_market_key: Pubkey,
    pub client: EllipsisClient,
}

impl SDKClient {
    /// RECOMMENDED:
    /// Converts base units to base lots. For example if the base currency was a Widget and you wanted to
    /// convert 3 Widgets to base lots you would call sdk.base_unit_to_base_lots(3.0). This would return
    /// the number of base lots that would be equivalent to 3 Widgets.
    pub fn base_units_to_base_lots(&self, base_units: f64) -> u64 {
        let market = self.markets.get(&self.active_market_key).unwrap();
        (base_units * market.base_multiplier as f64 / market.base_lot_size as f64) as u64
    }

    /// RECOMMENDED:
    /// Converts base amount to base lots. For example if the base currency was a Widget with 9 decimals and you wanted to
    /// convert 3 Widgets to base lots you would call sdk.base_amount_to_base_lots(3_000_000_000). This would return
    /// the number of base lots that would be equivalent to 3 Widgets.
    pub fn base_amount_to_base_lots(&self, base_amount: u64) -> u64 {
        let market = self.markets.get(&self.active_market_key).unwrap();
        base_amount / market.base_lot_size
    }

    /// RECOMMENDED:
    /// Converts base lots to base units. For example if the base currency was a Widget where there are
    /// 100 base lots per Widget, you would call sdk.base_lots_to_base_units(300) to convert 300 base lots
    /// to 3 Widgets.
    pub fn base_lots_to_base_amount(&self, base_lots: u64) -> u64 {
        let market = self.markets.get(&self.active_market_key).unwrap();
        base_lots * market.base_lot_size
    }

    /// RECOMMENDED:
    /// Converts quote units to quote lots. For example if the quote currency was USDC you wanted to
    /// convert 3 USDC to quote lots you would call sdk.quote_unit_to_quote_lots(3.0). This would return
    /// the number of quote lots that would be equivalent to 3 USDC.
    pub fn quote_units_to_quote_lots(&self, quote_units: f64) -> u64 {
        let market = self.markets.get(&self.active_market_key).unwrap();
        (quote_units * market.quote_multiplier as f64 / market.quote_lot_size as f64) as u64
    }

    /// RECOMMENDED:
    /// Converts quote amount to quote lots. For example if the quote currency was USDC with 6 decimals and you wanted to
    /// convert 3 USDC to quote lots you would call sdk.quote_amount_to_quote_lots(3_000_000). This would return
    /// the number of quote lots that would be equivalent to 3 USDC.
    pub fn quote_amount_to_quote_lots(&self, quote_amount: u64) -> u64 {
        let market = self.markets.get(&self.active_market_key).unwrap();
        quote_amount / market.quote_lot_size
    }

    /// RECOMMENDED:
    /// Converts quote lots to quote units. For example if the quote currency was USDC there are
    /// 100 quote lots per USDC (each quote lot is worth 0.01 USDC), you would call sdk.quote_lots_to_quote_units(300) to convert 300 quote lots
    /// to an amount equal to 3 USDC (3_000_000).
    pub fn quote_lots_to_quote_amount(&self, quote_lots: u64) -> u64 {
        let market = self.markets.get(&self.active_market_key).unwrap();
        quote_lots * market.quote_lot_size
    }

    /// Converts a base amount to a floating point number of base units. For example if the base currency
    /// is a Widget where the token has 9 decimals and you wanted to convert a base amount of 1000000000 to
    /// a floating point number of base units you would call sdk.base_amount_to_float(1_000_000_000). This
    /// would return 1.0. This is useful for displaying the base amount in a human readable format.
    pub fn base_amount_to_base_unit_as_float(&self, base_amount: u64) -> f64 {
        let market = self.markets.get(&self.active_market_key).unwrap();
        base_amount as f64 / market.base_multiplier as f64
    }

    /// Converts a quote amount to a floating point number of quote units. For example if the quote currency
    /// is USDC the token has 6 decimals and you wanted to convert a quote amount of 1000000 to
    /// a floating point number of quote units you would call sdk.quote_amount_to_float(1_000_000). This
    /// would return 1.0. This is useful for displaying the quote amount in a human readable format.
    pub fn quote_amount_to_quote_unit_as_float(&self, quote_amount: u64) -> f64 {
        let market = self.markets.get(&self.active_market_key).unwrap();
        quote_amount as f64 / market.quote_multiplier as f64
    }

    /// Takes in a quote amount and prints it as a human readable string to the console
    pub fn print_quote_amount(&self, quote_amount: u64) {
        let market = self.markets.get(&self.active_market_key).unwrap();
        println!(
            "{}",
            get_decimal_string(quote_amount, market.quote_decimals)
        );
    }

    /// Takes in a base amount and prints it as a human readable string to the console
    pub fn print_base_amount(&self, base_amount: u64) {
        let market = self.markets.get(&self.active_market_key).unwrap();
        println!("{}", get_decimal_string(base_amount, market.base_decimals));
    }

    /// Takes in information from a fill event and converts it into the equivalent quote amount
    pub fn fill_event_to_quote_amount(&self, fill: &Fill) -> u64 {
        let &Fill {
            base_lots_filled: base_lots,
            price_in_ticks,
            ..
        } = fill;
        self.order_to_quote_amount(base_lots, price_in_ticks)
    }

    /// Takes in tick price and base lots of an order converts it into the equivalent quote amount
    pub fn order_to_quote_amount(&self, base_lots: u64, price_in_ticks: u64) -> u64 {
        let market = self.markets.get(&self.active_market_key).unwrap();
        base_lots * price_in_ticks * market.num_quote_lots_per_tick * market.quote_lot_size
            / market.num_base_lots_per_base_unit
    }

    /// Takes in a price as a floating point number and converts it to a number of ticks (rounded down)
    pub fn float_price_to_ticks(&self, price: f64) -> u64 {
        let meta = self.get_active_market_metadata();
        ((price * meta.quote_multiplier as f64) / meta.tick_size as f64) as u64
    }

    /// Takes in a price as a floating point number and converts it to a number of ticks (rounded up)
    pub fn float_price_to_ticks_rounded_up(&self, price: f64) -> u64 {
        let meta = self.get_active_market_metadata();
        ((price * meta.quote_multiplier as f64) / meta.tick_size as f64).ceil() as u64
    }

    /// Takes in a number of ticks and converts it to a floating point number price
    pub fn ticks_to_float_price(&self, ticks: u64) -> f64 {
        let meta = self.get_active_market_metadata();
        (ticks as f64 * meta.tick_size as f64) / meta.quote_multiplier as f64
    }

    pub fn base_lots_to_base_units_multiplier(&self) -> f64 {
        let market = self.markets.get(&self.active_market_key).unwrap();
        1.0 / market.num_base_lots_per_base_unit as f64
    }

    pub fn ticks_to_float_price_multiplier(&self) -> f64 {
        let meta = self.get_active_market_metadata();
        meta.tick_size as f64 / meta.quote_multiplier as f64
    }
}

impl SDKClient {
    pub async fn new_from_ellipis_client(market_key: &Pubkey, client: EllipsisClient) -> Self {
        let market_metadata = Self::get_market_metadata(&client, market_key).await;
        let mut markets = BTreeMap::new();

        markets.insert(*market_key, market_metadata);

        SDKClient {
            markets,
            rng: Arc::new(Mutex::new(StdRng::from_entropy())),
            active_market_key: *market_key,
            client,
        }
    }

    pub fn new_from_ellipis_client_sync(market_key: &Pubkey, client: EllipsisClient) -> Self {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(Self::new_from_ellipis_client(market_key, client))
    }

    pub async fn new(market_key: &Pubkey, payer: &Keypair, url: &str) -> Self {
        let rpc = RpcClient::new_with_commitment(url, CommitmentConfig::confirmed());
        let client = EllipsisClient::from_rpc(rpc, payer).unwrap(); //fix error handling instead of panic
        let market_metadata = Self::get_market_metadata(&client, market_key).await;
        let mut markets = BTreeMap::new();

        markets.insert(*market_key, market_metadata);

        SDKClient {
            markets,
            rng: Arc::new(Mutex::new(StdRng::from_entropy())),
            active_market_key: *market_key,
            client,
        }
    }

    pub fn new_sync(market_key: &Pubkey, payer: &Keypair, url: &str) -> Self {
        let rt = tokio::runtime::Runtime::new().unwrap(); //fix error handling instead of panic
        rt.block_on(Self::new(market_key, payer, url))
    }

    pub fn get_next_client_order_id(&self) -> u128 {
        self.rng.lock().unwrap().gen::<u128>()
    }

    pub fn get_trader(&self) -> Pubkey {
        self.client.payer.pubkey()
    }

    pub fn change_active_market(&mut self, market: &Pubkey) -> anyhow::Result<()> {
        if self.markets.get(market).is_some() {
            self.active_market_key = *market;
            Ok(())
        } else {
            Err(anyhow::Error::msg("Market not found"))
        }
    }

    pub async fn add_market(&mut self, market_key: &Pubkey) -> anyhow::Result<()> {
        let market_metadata = Self::get_market_metadata(&self.client, market_key).await;

        self.markets.insert(*market_key, market_metadata);

        Ok(())
    }

    pub fn get_active_market_metadata(&self) -> &MarketMetadata {
        self.markets.get(&self.active_market_key).unwrap()
    }

    pub async fn get_market_ladder(&self, levels: u64) -> Ladder {
        let mut market_account_data = (self.client.get_account_data(&self.active_market_key))
            .await
            .unwrap();
        let (header_bytes, bytes) = market_account_data.split_at_mut(size_of::<MarketHeader>());
        let header = MarketHeader::try_from_slice(header_bytes).unwrap();
        let market = load_with_dispatch_mut(&header.market_params, bytes)
            .unwrap()
            .inner;

        market.get_ladder(levels)
    }

    pub fn get_market_ladder_sync(&self, levels: u64) -> Ladder {
        let rt = tokio::runtime::Runtime::new().unwrap(); //fix error handling instead of panic
        rt.block_on(self.get_market_ladder(levels))
    }

    pub async fn get_market_orderbook(&self) -> Orderbook<FIFOOrderId, PhoenixOrder> {
        let mut market_account_data = (self.client.get_account_data(&self.active_market_key))
            .await
            .unwrap();
        let (header_bytes, bytes) = market_account_data.split_at_mut(size_of::<MarketHeader>());
        let header = MarketHeader::try_from_slice(header_bytes).unwrap();
        let market = load_with_dispatch_mut(&header.market_params, bytes)
            .unwrap()
            .inner;

        let traders = market
            .get_registered_traders()
            .iter()
            .map(|(trader, _)| *trader)
            .collect::<Vec<_>>();

        let mut index_to_trader = BTreeMap::new();
        for trader in traders.iter() {
            let index = market.get_trader_address(trader).unwrap();
            index_to_trader.insert(index as u64, *trader);
        }

        let mut orderbook = Orderbook {
            size_mult: self.base_lots_to_base_units_multiplier(),
            price_mult: self.ticks_to_float_price_multiplier(),
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
                            },
                        )| {
                            (
                                k,
                                PhoenixOrder {
                                    num_base_lots,
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

    pub fn get_market_orderbook_sync(&self) -> Orderbook<FIFOOrderId, PhoenixOrder> {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(self.get_market_orderbook())
    }

    #[allow(clippy::useless_conversion)]
    async fn get_market_metadata(client: &EllipsisClient, market_key: &Pubkey) -> MarketMetadata {
        let mut market_account_data = (client.get_account_data(market_key)).await.unwrap();
        let (header_bytes, bytes) = market_account_data.split_at_mut(size_of::<MarketHeader>());
        let header = MarketHeader::try_from_slice(header_bytes).unwrap();
        let market = load_with_dispatch_mut(&header.market_params, bytes)
            .unwrap()
            .inner;

        let base_mint_acct = spl_token::state::Mint::unpack(
            &client
                .get_account_data(&header.base_params.mint_key)
                .await
                .unwrap(),
        )
        .unwrap();
        let quote_mint_acct = spl_token::state::Mint::unpack(
            &client
                .get_account_data(&header.quote_params.mint_key)
                .await
                .unwrap(),
        )
        .unwrap();

        let quote_lot_size = header.get_quote_lot_size().into();
        let base_lot_size = header.get_base_lot_size().into();
        let quote_multiplier = 10u64.pow(quote_mint_acct.decimals as u32);
        let base_multiplier = 10u64.pow(base_mint_acct.decimals as u32);
        let base_mint = header.base_params.mint_key;
        let quote_mint = header.quote_params.mint_key;
        let tick_size = header.get_tick_size().into();
        let num_base_lots_per_base_unit = market.get_base_lots_per_base_unit().into();
        let num_quote_lots_per_tick = market.get_quote_lots_per_tick().into();

        MarketMetadata {
            base_mint,
            quote_mint,
            base_decimals: base_mint_acct.decimals as u32,
            quote_decimals: quote_mint_acct.decimals as u32,
            base_multiplier,
            quote_multiplier,
            tick_size,
            quote_lot_size,
            base_lot_size,
            num_base_lots_per_base_unit,
            num_quote_lots_per_tick,
        }
    }

    pub async fn parse_events_from_transaction(
        &self,
        sig: &Signature,
    ) -> Option<Vec<PhoenixEvent>> {
        let tx = self.client.get_transaction(sig).await.ok()?;
        let mut event_list = vec![];
        for inner_ixs in tx.inner_instructions.iter() {
            let mut in_cpi = false;
            for inner_ix in inner_ixs.iter() {
                let parent_program_id = tx.instructions[inner_ix.parent_index].program_id.clone();
                let current_program_id = inner_ix.instruction.program_id.clone();
                let called_by_phoenix = parent_program_id == phoenix::id().to_string();
                let is_wrapper_program = current_program_id == spl_noop::id().to_string();
                // Not comprehensive, but should be good enough for now
                if current_program_id == phoenix::id().to_string() {
                    // if current_program_id is the Phoenix program, we know that the instruction is a CPI
                    in_cpi = true;
                } else if in_cpi
                    && ![spl_token::id().to_string(), spl_noop::id().to_string()]
                        .contains(&current_program_id)
                {
                    // if we are in a CPI and current_program_id is not a token or noop program,
                    // we know that the CPI has completed
                    in_cpi = false;
                }
                if (called_by_phoenix || in_cpi) && is_wrapper_program {
                    event_list.push(inner_ix.instruction.data.clone());
                }
            }
        }
        self.parse_wrapper_events(sig, event_list)
    }

    pub async fn parse_places(&self, signature: &Signature) -> Vec<PhoenixEvent> {
        let events = self
            .parse_events_from_transaction(signature)
            .await
            .unwrap_or_default();
        events
            .iter()
            .filter_map(|&event| match event.details {
                MarketEventDetails::Place(..) => Some(event),
                _ => None,
            })
            .collect::<Vec<PhoenixEvent>>()
    }

    pub async fn parse_cancels(&self, signature: &Signature) -> Vec<PhoenixEvent> {
        let events = self
            .parse_events_from_transaction(signature)
            .await
            .unwrap_or_default();
        events
            .iter()
            .filter_map(|&event| match event.details {
                MarketEventDetails::Reduce(..) => Some(event),
                _ => None,
            })
            .collect::<Vec<PhoenixEvent>>()
    }

    pub async fn parse_fills(&self, signature: &Signature) -> Vec<PhoenixEvent> {
        let events = self
            .parse_events_from_transaction(signature)
            .await
            .unwrap_or_default();
        events
            .iter()
            .filter_map(|&event| match event.details {
                MarketEventDetails::Fill(..) => Some(event),
                _ => None,
            })
            .collect::<Vec<PhoenixEvent>>()
    }

    pub async fn parse_fills_and_places(
        &self,
        signature: &Signature,
    ) -> (Vec<PhoenixEvent>, Vec<PhoenixEvent>) {
        let events = self
            .parse_events_from_transaction(signature)
            .await
            .unwrap_or_default();
        let fills = events
            .iter()
            .filter_map(|&event| match event.details {
                MarketEventDetails::Fill(..) => Some(event),
                _ => None,
            })
            .collect::<Vec<PhoenixEvent>>();
        let places = events
            .iter()
            .filter_map(|&event| match event.details {
                MarketEventDetails::Place(..) => Some(event),
                _ => None,
            })
            .collect::<Vec<PhoenixEvent>>();

        (fills, places)
    }

    fn parse_wrapper_events(
        &self,
        sig: &Signature,
        events: Vec<Vec<u8>>,
    ) -> Option<Vec<PhoenixEvent>> {
        let mut market_events: Vec<PhoenixEvent> = vec![];
        let meta = self.get_active_market_metadata();

        for event in events.iter() {
            let num_bytes = event.len();
            let header_event = MarketEvent::try_from_slice(&event[..AUDIT_LOG_HEADER_LEN]).ok()?;
            let header = match header_event {
                MarketEvent::Header { header } => Some(header),
                _ => {
                    panic!("Expected a header event");
                }
            }?;
            let mut offset = AUDIT_LOG_HEADER_LEN;
            while offset < num_bytes {
                match MarketEventWrapper::try_from_slice(&[event[offset]]).ok()? {
                    MarketEventWrapper::Fill => {
                        let size = 67;
                        let fill_event =
                            MarketEvent::try_from_slice(&event[offset..offset + size]).ok()?;
                        offset += size;

                        match fill_event {
                            MarketEvent::Fill {
                                index,
                                maker_id,
                                order_sequence_number,
                                price_in_ticks,
                                base_lots_filled,
                                base_lots_remaining,
                            } => market_events.push(PhoenixEvent {
                                market: header.market,
                                sequence_number: header.market_sequence_number,
                                slot: header.slot,
                                timestamp: header.timestamp,
                                signature: *sig,
                                signer: header.signer,
                                event_index: index as u64,
                                details: MarketEventDetails::Fill(Fill {
                                    order_sequence_number,
                                    maker: maker_id,
                                    taker: header.signer,
                                    price_in_ticks,
                                    base_lots_filled,
                                    base_lots_remaining,
                                    side_filled: Side::from_order_sequence_number(
                                        order_sequence_number,
                                    ),
                                    is_full_fill: base_lots_remaining == 0,
                                }),
                            }),
                            _ => panic!("Expected a fill event"),
                        };
                    }

                    MarketEventWrapper::Reduce => {
                        let size = 35;
                        let reduce_event =
                            MarketEvent::try_from_slice(&event[offset..offset + size]).ok()?;
                        offset += size;

                        match reduce_event {
                            MarketEvent::Reduce {
                                index,
                                order_sequence_number,
                                price_in_ticks,
                                base_lots_removed: _,
                                base_lots_remaining,
                            } => market_events.push(PhoenixEvent {
                                market: header.market,
                                sequence_number: header.market_sequence_number,
                                slot: header.slot,
                                timestamp: header.timestamp,
                                signature: *sig,
                                signer: header.signer,
                                event_index: index as u64,
                                details: MarketEventDetails::Reduce(Reduce {
                                    order_sequence_number,
                                    maker: header.signer,
                                    price_in_ticks,
                                    base_lots_remaining,
                                    is_full_cancel: base_lots_remaining == 0,
                                }),
                            }),
                            _ => {
                                panic!("Expected a reduce event");
                            }
                        };
                    }

                    MarketEventWrapper::Place => {
                        let size = 43;
                        let place_event =
                            MarketEvent::try_from_slice(&event[offset..offset + size]).ok()?;
                        offset += size;

                        match place_event {
                            MarketEvent::Place {
                                index,
                                order_sequence_number,
                                client_order_id,
                                price_in_ticks,
                                base_lots_placed,
                            } => market_events.push(PhoenixEvent {
                                market: header.market,
                                sequence_number: header.market_sequence_number,
                                slot: header.slot,
                                timestamp: header.timestamp,
                                signature: *sig,
                                signer: header.signer,
                                event_index: index as u64,
                                details: MarketEventDetails::Place(Place {
                                    order_sequence_number,
                                    client_order_id,
                                    maker: header.signer,
                                    price_in_ticks,
                                    base_lots_placed,
                                }),
                            }),
                            _ => {
                                panic!("Expected a place event");
                            }
                        };
                    }

                    MarketEventWrapper::Evict => {
                        let size = 58;
                        let evict_event =
                            MarketEvent::try_from_slice(&event[offset..offset + size]).ok()?;
                        offset += size;

                        match evict_event {
                            MarketEvent::Evict {
                                index,
                                maker_id,
                                order_sequence_number,
                                price_in_ticks,
                                base_lots_evicted,
                            } => market_events.push(PhoenixEvent {
                                market: header.market,
                                sequence_number: header.market_sequence_number,
                                slot: header.slot,
                                timestamp: header.timestamp,
                                signature: *sig,
                                signer: header.signer,
                                event_index: index as u64,
                                details: MarketEventDetails::Evict(Evict {
                                    order_sequence_number,
                                    maker: maker_id,
                                    price_in_ticks,
                                    base_lots_evicted,
                                }),
                            }),
                            _ => {
                                panic!("Expected a place event");
                            }
                        };
                    }
                    MarketEventWrapper::FillSummary => {
                        let size = 43;
                        let fill_summary_event =
                            MarketEvent::try_from_slice(&event[offset..offset + size]).ok()?;
                        offset += size;
                        println!("Fill summary event: {:?}", fill_summary_event);

                        match fill_summary_event {
                            MarketEvent::FillSummary {
                                index,
                                client_order_id,
                                total_base_lots_filled,
                                total_quote_lots_filled,
                                total_fee_in_quote_lots,
                            } => market_events.push(PhoenixEvent {
                                market: header.market,
                                sequence_number: header.market_sequence_number,
                                slot: header.slot,
                                timestamp: header.timestamp,
                                signature: *sig,
                                signer: header.signer,
                                event_index: index as u64,
                                details: MarketEventDetails::FillSummary(FillSummary {
                                    client_order_id,
                                    total_base_filled: total_base_lots_filled * meta.base_lot_size,
                                    total_quote_filled_including_fees: total_quote_lots_filled
                                        * meta.quote_lot_size,
                                    total_quote_fees: total_fee_in_quote_lots * meta.quote_lot_size,
                                }),
                            }),
                            _ => {
                                panic!("Expected fill summary event");
                            }
                        };
                    }

                    _ => {
                        panic!("Unexpected Event!");
                    }
                }
            }
        }
        Some(market_events)
    }

    pub async fn send_ioc(
        &self,
        price: u64,
        side: Side,
        size: u64,
    ) -> Option<(Signature, Vec<PhoenixEvent>)> {
        let new_order_ix = self.get_ioc_ix(price, side, size);
        let signature = self
            .client
            .sign_send_instructions(vec![new_order_ix], vec![])
            .await
            .ok()?;
        let fills = self.parse_fills(&signature).await;
        Some((signature, fills))
    }

    pub fn get_ioc_ix(&self, price: u64, side: Side, num_base_lots: u64) -> Instruction {
        self.get_ioc_generic_ix(price, side, num_base_lots, None, None, None, None)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn get_ioc_generic_ix(
        &self,
        price: u64,
        side: Side,
        num_base_lots: u64,
        self_trade_behavior: Option<SelfTradeBehavior>,
        match_limit: Option<u64>,
        client_order_id: Option<u128>,
        use_only_deposited_funds: Option<bool>,
    ) -> Instruction {
        let meta = &self.markets[&self.active_market_key];
        let num_quote_ticks_per_base_unit = price / meta.tick_size;
        let self_trade_behavior = self_trade_behavior.unwrap_or(SelfTradeBehavior::CancelProvide);
        let client_order_id = client_order_id.unwrap_or(0);
        let use_only_deposited_funds = use_only_deposited_funds.unwrap_or(false);
        create_new_order_instruction(
            &self.active_market_key.clone(),
            &self.get_trader(),
            &meta.base_mint,
            &meta.quote_mint,
            &OrderPacket::new_ioc_by_lots(
                side,
                num_quote_ticks_per_base_unit,
                num_base_lots,
                self_trade_behavior,
                match_limit,
                client_order_id,
                use_only_deposited_funds,
            ),
        )
    }

    pub async fn send_fok_buy(
        &self,
        price: u64,
        size_in_quote_lots: u64,
    ) -> Option<(Signature, Vec<PhoenixEvent>)> {
        let new_order_ix = self.get_fok_buy_ix(price, size_in_quote_lots);

        let signature = self
            .client
            .sign_send_instructions(vec![new_order_ix], vec![])
            .await
            .ok()?;
        let fills = self.parse_fills(&signature).await;
        Some((signature, fills))
    }

    pub async fn send_fok_sell(
        &self,
        price: u64,
        size_in_base_lots: u64,
    ) -> Option<(Signature, Vec<PhoenixEvent>)> {
        let new_order_ix = self.get_fok_sell_ix(price, size_in_base_lots);

        let signature = self
            .client
            .sign_send_instructions(vec![new_order_ix], vec![])
            .await
            .ok()?;
        let fills = self.parse_fills(&signature).await;
        Some((signature, fills))
    }

    pub fn get_fok_buy_ix(&self, price: u64, size_in_quote_lots: u64) -> Instruction {
        self.get_fok_generic_ix(price, Side::Bid, size_in_quote_lots, None, None, None, None)
    }

    pub fn get_fok_sell_ix(&self, price: u64, size_in_base_lots: u64) -> Instruction {
        self.get_fok_generic_ix(price, Side::Ask, size_in_base_lots, None, None, None, None)
    }

    pub fn get_fok_buy_generic_ix(
        &self,
        price: u64,
        size_in_quote_lots: u64,
        self_trade_behavior: Option<SelfTradeBehavior>,
        match_limit: Option<u64>,
        client_order_id: Option<u128>,
        use_only_deposited_funds: Option<bool>,
    ) -> Instruction {
        self.get_fok_generic_ix(
            price,
            Side::Bid,
            size_in_quote_lots,
            self_trade_behavior,
            match_limit,
            client_order_id,
            use_only_deposited_funds,
        )
    }

    pub fn get_fok_sell_generic_ix(
        &self,
        price: u64,
        size_in_base_lots: u64,
        self_trade_behavior: Option<SelfTradeBehavior>,
        match_limit: Option<u64>,
        client_order_id: Option<u128>,
        use_only_deposited_funds: Option<bool>,
    ) -> Instruction {
        self.get_fok_generic_ix(
            price,
            Side::Ask,
            size_in_base_lots,
            self_trade_behavior,
            match_limit,
            client_order_id,
            use_only_deposited_funds,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn get_fok_generic_ix(
        &self,
        price: u64,
        side: Side,
        size: u64,
        self_trade_behavior: Option<SelfTradeBehavior>,
        match_limit: Option<u64>,
        client_order_id: Option<u128>,
        use_only_deposited_funds: Option<bool>,
    ) -> Instruction {
        let meta = &self.markets[&self.active_market_key];
        let self_trade_behavior = self_trade_behavior.unwrap_or(SelfTradeBehavior::CancelProvide);
        let client_order_id = client_order_id.unwrap_or(0);
        let target_price_in_ticks = price / meta.tick_size;
        let use_only_deposited_funds = use_only_deposited_funds.unwrap_or(false);
        match side {
            Side::Bid => {
                let quote_lot_budget = size / meta.quote_lot_size;
                create_new_order_instruction(
                    &self.active_market_key.clone(),
                    &self.get_trader(),
                    &meta.base_mint,
                    &meta.quote_mint,
                    &OrderPacket::new_fok_buy_with_limit_price(
                        target_price_in_ticks,
                        quote_lot_budget,
                        self_trade_behavior,
                        match_limit,
                        client_order_id,
                        use_only_deposited_funds,
                    ),
                )
            }
            Side::Ask => {
                let num_base_lots = size / meta.base_lot_size;
                create_new_order_instruction(
                    &self.active_market_key.clone(),
                    &self.get_trader(),
                    &meta.base_mint,
                    &meta.quote_mint,
                    &OrderPacket::new_fok_sell_with_limit_price(
                        target_price_in_ticks,
                        num_base_lots,
                        SelfTradeBehavior::CancelProvide,
                        match_limit,
                        client_order_id,
                        use_only_deposited_funds,
                    ),
                )
            }
        }
    }

    pub async fn send_ioc_with_slippage(
        &self,
        lots_in: u64,
        min_lots_out: u64,
        side: Side,
    ) -> Option<(Signature, Vec<PhoenixEvent>)> {
        let new_order_ix = self.get_ioc_with_slippage_ix(lots_in, min_lots_out, side);
        let signature = self
            .client
            .sign_send_instructions(vec![new_order_ix], vec![])
            .await
            .ok()?;
        let fills = self.parse_fills(&signature).await;
        Some((signature, fills))
    }

    pub fn get_ioc_with_slippage_ix(
        &self,
        lots_in: u64,
        min_lots_out: u64,
        side: Side,
    ) -> Instruction {
        let meta = self.get_active_market_metadata();

        let order_type = match side {
            Side::Bid => OrderPacket::new_ioc_buy_with_slippage(lots_in, min_lots_out),
            Side::Ask => OrderPacket::new_ioc_sell_with_slippage(lots_in, min_lots_out),
        };

        create_new_order_instruction(
            &self.active_market_key.clone(),
            &self.get_trader(),
            &meta.base_mint,
            &meta.quote_mint,
            &order_type,
        )
    }

    pub fn get_ioc_from_tick_price_ix(
        &self,
        tick_price: u64,
        side: Side,
        size: u64,
    ) -> Instruction {
        let meta = &self.markets[&self.active_market_key];

        create_new_order_instruction(
            &self.active_market_key.clone(),
            &self.get_trader(),
            &meta.base_mint,
            &meta.quote_mint,
            &OrderPacket::new_ioc_by_lots(
                side,
                tick_price,
                size,
                SelfTradeBehavior::CancelProvide,
                None,
                self.rng.lock().unwrap().gen::<u128>(),
                false,
            ),
        )
    }

    pub async fn send_post_only(
        &self,
        price: u64,
        side: Side,
        size: u64,
    ) -> Option<(Signature, Vec<PhoenixEvent>)> {
        let new_order_ix = self.get_post_only_ix(price, side, size);
        let signature = self
            .client
            .sign_send_instructions(vec![new_order_ix], vec![])
            .await
            .ok()?;
        let fills = self.parse_fills(&signature).await;
        Some((signature, fills))
    }

    pub fn get_post_only_ix(&self, price: u64, side: Side, size: u64) -> Instruction {
        self.get_post_only_generic_ix(price, side, size, None, None, None)
    }

    pub fn get_post_only_generic_ix(
        &self,
        price: u64,
        side: Side,
        size: u64,
        client_order_id: Option<u128>,
        reject_post_only: Option<bool>,
        use_only_deposited_funds: Option<bool>,
    ) -> Instruction {
        let meta = &self.markets[&self.active_market_key];
        let price_in_ticks = price / meta.tick_size;
        let client_order_id = client_order_id.unwrap_or(0);
        let reject_post_only = reject_post_only.unwrap_or(false);
        let use_only_deposited_funds = use_only_deposited_funds.unwrap_or(false);
        create_new_order_instruction(
            &self.active_market_key.clone(),
            &self.get_trader(),
            &meta.base_mint,
            &meta.quote_mint,
            &OrderPacket::new_post_only(
                side,
                price_in_ticks,
                size,
                client_order_id,
                reject_post_only,
                use_only_deposited_funds,
            ),
        )
    }

    pub fn get_post_only_ix_from_tick_price(
        &self,
        tick_price: u64,
        side: Side,
        size: u64,
        client_order_id: u128,
        improve_price_on_cross: bool,
    ) -> Instruction {
        let meta = &self.markets[&self.active_market_key];
        create_new_order_instruction(
            &self.active_market_key.clone(),
            &self.get_trader(),
            &meta.base_mint,
            &meta.quote_mint,
            &if improve_price_on_cross {
                OrderPacket::new_adjustable_post_only_default_with_client_order_id(
                    side,
                    tick_price,
                    size,
                    client_order_id,
                )
            } else {
                OrderPacket::new_post_only_default_with_client_order_id(
                    side,
                    tick_price,
                    size,
                    client_order_id,
                )
            },
        )
    }

    pub async fn send_limit_order(
        &self,
        price: u64,
        side: Side,
        size: u64,
    ) -> Option<(Signature, Vec<PhoenixEvent>, Vec<PhoenixEvent>)> {
        let new_order_ix = self.get_limit_order_ix(price, side, size);
        let signature = self
            .client
            .sign_send_instructions(vec![new_order_ix], vec![])
            .await
            .ok()?;
        let (fills, places) = self.parse_fills_and_places(&signature).await;
        Some((signature, places, fills))
    }

    pub fn get_limit_order_ix(&self, price: u64, side: Side, size: u64) -> Instruction {
        self.get_limit_order_generic_ix(price, side, size, None, None, None, None)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn get_limit_order_generic_ix(
        &self,
        price: u64,
        side: Side,
        size: u64,
        self_trade_behavior: Option<SelfTradeBehavior>,
        match_limit: Option<u64>,
        client_order_id: Option<u128>,
        use_only_deposited_funds: Option<bool>,
    ) -> Instruction {
        let meta = &self.markets[&self.active_market_key];
        let num_quote_ticks_per_base_unit = price / meta.tick_size;
        let self_trade_behavior = self_trade_behavior.unwrap_or(SelfTradeBehavior::DecrementTake);
        let client_order_id = client_order_id.unwrap_or(0);
        let use_only_deposited_funds = use_only_deposited_funds.unwrap_or(false);
        create_new_order_instruction(
            &self.active_market_key.clone(),
            &self.get_trader(),
            &meta.base_mint,
            &meta.quote_mint,
            &OrderPacket::new_limit_order(
                side,
                num_quote_ticks_per_base_unit,
                size,
                self_trade_behavior,
                match_limit,
                client_order_id,
                use_only_deposited_funds,
            ),
        )
    }

    pub fn get_limit_order_ix_from_tick_price(
        &self,
        tick_price: u64,
        side: Side,
        size: u64,
        client_order_id: u128,
    ) -> Instruction {
        let meta = &self.markets[&self.active_market_key];
        create_new_order_instruction(
            &self.active_market_key.clone(),
            &self.get_trader(),
            &meta.base_mint,
            &meta.quote_mint,
            &OrderPacket::new_limit_order_default_with_client_order_id(
                side,
                tick_price,
                size,
                client_order_id,
            ),
        )
    }

    pub async fn send_cancel_ids(
        &self,
        ids: Vec<FIFOOrderId>,
    ) -> Option<(Signature, Vec<PhoenixEvent>)> {
        let cancel_ix = self.get_cancel_ids_ix(ids);
        let signature = self
            .client
            .sign_send_instructions(vec![cancel_ix], vec![])
            .await
            .ok()?;

        let cancels = self.parse_cancels(&signature).await;
        Some((signature, cancels))
    }

    pub fn get_cancel_ids_ix(&self, ids: Vec<FIFOOrderId>) -> Instruction {
        let mut cancel_orders = vec![];
        for &FIFOOrderId {
            num_quote_ticks_per_base_unit,
            order_sequence_number,
        } in ids.iter()
        {
            cancel_orders.push(CancelOrderParams {
                side: Side::from_order_sequence_number(order_sequence_number),
                num_quote_ticks_per_base_unit,
                order_id: order_sequence_number,
            });
        }
        let meta = &self.markets[&self.active_market_key];
        let cancel_multiple_orders = CancelMultipleOrdersByIdParams {
            orders: cancel_orders,
        };

        create_cancel_multiple_orders_by_id_instruction(
            &self.active_market_key.clone(),
            &self.get_trader(),
            &meta.base_mint,
            &meta.quote_mint,
            &cancel_multiple_orders,
        )
    }

    pub async fn send_cancel_multiple(
        &self,
        tick_limit: Option<u64>,
        side: Side,
    ) -> Option<(Signature, Vec<PhoenixEvent>)> {
        let cancel_ix = self.get_cancel_multiple_ix(tick_limit, side);
        let signature = self
            .client
            .sign_send_instructions(vec![cancel_ix], vec![])
            .await
            .ok()?;

        let cancels = self.parse_cancels(&signature).await;
        Some((signature, cancels))
    }

    pub fn get_cancel_multiple_ix(&self, tick_limit: Option<u64>, side: Side) -> Instruction {
        let params = CancelMultipleOrdersParams {
            side,
            tick_limit,
            num_orders_to_search: None,
            num_orders_to_cancel: None,
        };

        let meta = &self.markets[&self.active_market_key];
        create_cancel_multiple_orders_instruction(
            &self.active_market_key.clone(),
            &self.get_trader(),
            &meta.base_mint,
            &meta.quote_mint,
            &params,
        )
    }

    pub async fn send_cancel_all(&self) -> Option<(Signature, Vec<PhoenixEvent>)> {
        let cancel_all_ix = self.get_cancel_multiple_ix(None, Side::Bid);
        let signature = self
            .client
            .sign_send_instructions(vec![cancel_all_ix], vec![])
            .await
            .ok()?;

        let cancels = self.parse_cancels(&signature).await;
        Some((signature, cancels))
    }
}
