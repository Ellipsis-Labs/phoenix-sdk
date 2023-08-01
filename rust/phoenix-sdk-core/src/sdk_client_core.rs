use anyhow::anyhow;

use anyhow::Result;
use borsh::BorshDeserialize;
use ellipsis_transaction_utils::ParsedTransaction;
use itertools::Itertools;
use phoenix::program::MarketHeader;
use phoenix::program::MarketSizeParams;
use phoenix::program::PhoenixInstruction;
use phoenix::quantities::QuoteLots;
use phoenix::{
    program::cancel_multiple_orders::{CancelMultipleOrdersByIdParams, CancelUpToParams},
    program::events::PhoenixMarketEvent,
    program::instruction_builders::{
        create_cancel_all_orders_instruction, create_cancel_multiple_orders_by_id_instruction,
        create_cancel_up_to_instruction, create_new_order_instruction,
        create_withdraw_funds_instruction,
    },
    program::reduce_order::CancelOrderParams,
    quantities::{BaseLots, Ticks, WrapperU64},
    state::enums::{SelfTradeBehavior, Side},
    state::markets::FIFOOrderId,
    state::order_packet::OrderPacket,
    state::trader_state::TraderState,
};
use rand::{rngs::StdRng, Rng};
use solana_program::{instruction::Instruction, pubkey::Pubkey};
use solana_sdk::signature::Signature;
use std::str::FromStr;
use std::{
    collections::BTreeMap,
    fmt::Display,
    ops::{Div, Rem},
};

use crate::{market_event::Fill, orderbook::Orderbook};

const AUDIT_LOG_HEADER_LEN: usize = 92;

pub struct MarketState {
    /// State of the bids and offers in the market.
    pub orderbook: Orderbook<FIFOOrderId, PhoenixOrder>,
    /// Authorized makers in the market.
    pub traders: BTreeMap<Pubkey, TraderState>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct RawPhoenixHeader {
    pub signature: Signature,
    pub instruction: u8,
    pub sequence_number: u64,
    pub timestamp: i64,
    pub slot: u64,
    pub market: Pubkey,
    pub signer: Pubkey,
}

#[derive(Clone, Debug, Default)]
pub struct RawPhoenixEvent {
    pub header: RawPhoenixHeader,
    pub batch: Vec<PhoenixMarketEvent>,
}

#[derive(Clone, Copy, Debug)]
pub struct PhoenixOrder {
    pub num_base_lots: u64,
    pub maker_id: Pubkey,
}

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
    let rhs = {
        let trim_zero = rhs.trim_end_matches('0');
        match trim_zero {
            "" => "0",
            _ => trim_zero,
        }
    };
    format!("{}.{}", lhs, rhs)
}

#[derive(Clone, Copy, Debug, Default)]
pub struct MarketMetadata {
    pub base_mint: Pubkey,
    pub quote_mint: Pubkey,
    pub base_decimals: u32,
    pub quote_decimals: u32,
    /// 10^base_decimals
    pub base_atoms_per_raw_base_unit: u64,
    /// 10^quote_decimals
    pub quote_atoms_per_quote_unit: u64,
    pub quote_atoms_per_quote_lot: u64,
    pub base_atoms_per_base_lot: u64,
    pub tick_size_in_quote_atoms_per_base_unit: u64,
    pub num_base_lots_per_base_unit: u64,
    /// The adjustment factor to convert from the raw base unit (i.e. 1 BONK token) to the Phoenix BaseUnit (which may be a multiple of whole tokens).
    /// The adjustment factor is almost always 1, unless one base token is worth less than one quote atom (i.e. 1e-6 USDC)
    pub raw_base_units_per_base_unit: u32,
    pub market_size_params: MarketSizeParams,
}

impl MarketMetadata {
    pub fn from_header(header: &MarketHeader) -> Result<Self> {
        let quote_atoms_per_quote_lot = header.get_quote_lot_size().into();
        let base_atoms_per_base_lot = header.get_base_lot_size().into();
        let quote_atoms_per_quote_unit = 10u64.pow(header.quote_params.decimals);
        let base_atoms_per_raw_base_unit = 10u64.pow(header.base_params.decimals);
        let base_mint = header.base_params.mint_key;
        let quote_mint = header.quote_params.mint_key;
        let tick_size_in_quote_atoms_per_base_unit =
            header.get_tick_size_in_quote_atoms_per_base_unit().into();
        // max(1) is only relevant for old markets where the raw_base_units_per_base_unit was not set
        let raw_base_units_per_base_unit = header.raw_base_units_per_base_unit.max(1);
        if base_atoms_per_raw_base_unit * raw_base_units_per_base_unit as u64
            % base_atoms_per_base_lot
            != 0
        {
            return Err(anyhow!(
                "Invalid base lot size (in base atoms per base lot)"
            ));
        }

        let num_base_lots_per_base_unit = (base_atoms_per_raw_base_unit
            * raw_base_units_per_base_unit as u64)
            / base_atoms_per_base_lot;

        Ok(MarketMetadata {
            base_mint,
            quote_mint,
            base_decimals: header.base_params.decimals,
            quote_decimals: header.quote_params.decimals,
            base_atoms_per_raw_base_unit,
            quote_atoms_per_quote_unit,
            tick_size_in_quote_atoms_per_base_unit,
            quote_atoms_per_quote_lot,
            base_atoms_per_base_lot,
            num_base_lots_per_base_unit,
            raw_base_units_per_base_unit,
            market_size_params: header.market_size_params,
        })
    }
}

impl MarketMetadata {
    /// Given a number of raw base units, returns the equivalent number of base lots (rounded down).
    pub fn raw_base_units_to_base_lots_rounded_down(&self, raw_base_units: f64) -> u64 {
        let base_units = raw_base_units / self.raw_base_units_per_base_unit as f64;
        (base_units * (self.num_base_lots_per_base_unit as f64)).floor() as u64
    }

    /// Given a number of raw base units, returns the equivalent number of base lots (rounded up).
    pub fn raw_base_units_to_base_lots_rounded_up(&self, raw_base_units: f64) -> u64 {
        let base_units = raw_base_units / self.raw_base_units_per_base_unit as f64;
        (base_units * (self.num_base_lots_per_base_unit as f64)).ceil() as u64
    }

    /// Given a number of base atoms, returns the equivalent number of base lots (rounded down).
    pub fn base_atoms_to_base_lots_rounded_down(&self, base_atoms: u64) -> u64 {
        base_atoms / self.base_atoms_per_base_lot
    }

    /// Given a number of base atoms, returns the equivalent number of base lots (rounded up).
    pub fn base_atoms_to_base_lots_rounded_up(&self, base_atoms: u64) -> u64 {
        1 + base_atoms.saturating_sub(1) / self.base_atoms_per_base_lot
    }

    /// Given a number of base lots, returns the equivalent number of base atoms.
    pub fn base_lots_to_base_atoms(&self, base_lots: u64) -> u64 {
        base_lots * self.base_atoms_per_base_lot
    }

    /// Given a number of quote units, returns the equivalent number of quote lots.
    pub fn quote_units_to_quote_lots(&self, quote_units: f64) -> u64 {
        (quote_units * (self.quote_atoms_per_quote_unit / self.quote_atoms_per_quote_lot) as f64)
            as u64
    }

    /// Given a number of quote atoms, returns the equivalent number of quote lots (rounded down).
    pub fn quote_atoms_to_quote_lots_rounded_down(&self, quote_atoms: u64) -> u64 {
        quote_atoms / self.quote_atoms_per_quote_lot
    }

    /// Given a number of quote atoms, returns the equivalent number of quote lots (rounded up).
    pub fn quote_atoms_to_quote_lots_rounded_up(&self, quote_atoms: u64) -> u64 {
        1 + quote_atoms.saturating_sub(1) / self.quote_atoms_per_quote_lot
    }

    /// Given a number of quote lots, returns the equivalent number of quote atoms.
    pub fn quote_lots_to_quote_atoms(&self, quote_lots: u64) -> u64 {
        quote_lots * self.quote_atoms_per_quote_lot
    }

    /// Given a number of base atoms, returns the equivalent number of raw base units.
    pub fn base_atoms_to_raw_base_units_as_float(&self, base_atoms: u64) -> f64 {
        base_atoms as f64 / self.base_atoms_per_raw_base_unit as f64
    }

    /// Given a number of quote atoms, returns the equivalent number of quote units.
    pub fn quote_atoms_to_quote_units_as_float(&self, quote_atoms: u64) -> f64 {
        quote_atoms as f64 / self.quote_atoms_per_quote_unit as f64
    }

    /// Given a number of base lots and price in ticks, returns the equivalent number of quote atoms
    /// for that price and number of base lots.
    pub fn base_lots_and_price_to_quote_atoms(&self, base_lots: u64, price_in_ticks: u64) -> u64 {
        base_lots * price_in_ticks * self.tick_size_in_quote_atoms_per_base_unit
            / self.num_base_lots_per_base_unit
    }

    /// Given a price in quote units per raw base unit (represented as a float), returns
    /// the corresponding number of ticks (rounded down)
    pub fn float_price_to_ticks_rounded_down(&self, price: f64) -> u64 {
        ((price
            * self.raw_base_units_per_base_unit as f64
            * self.quote_atoms_per_quote_unit as f64)
            / self.tick_size_in_quote_atoms_per_base_unit as f64) as u64
    }

    /// Given a price in quote units per raw base unit (represented as a float), returns
    /// the corresponding number of ticks (rounded up)
    pub fn float_price_to_ticks_rounded_up(&self, price: f64) -> u64 {
        ((price
            * self.raw_base_units_per_base_unit as f64
            * self.quote_atoms_per_quote_unit as f64)
            / self.tick_size_in_quote_atoms_per_base_unit as f64)
            .ceil() as u64
    }

    /// Given a number of ticks, returns the corresponding price in quote units per raw base unit (as a float)
    pub fn ticks_to_float_price(&self, ticks: u64) -> f64 {
        ticks as f64 * self.tick_size_in_quote_atoms_per_base_unit as f64
            / (self.quote_atoms_per_quote_unit as f64 * self.raw_base_units_per_base_unit as f64)
    }

    /// Returns the base lot size in raw base units (as a float)
    pub fn raw_base_units_per_base_lot(&self) -> f64 {
        self.base_atoms_per_base_lot as f64 / self.base_atoms_per_raw_base_unit as f64
    }

    /// Returns the tick size in quote units per raw base unit
    pub fn quote_units_per_raw_base_unit_per_tick(&self) -> f64 {
        self.tick_size_in_quote_atoms_per_base_unit as f64
            / (self.quote_atoms_per_quote_unit as f64 * self.raw_base_units_per_base_unit as f64)
    }
}

pub struct SDKClientCore {
    pub markets: BTreeMap<Pubkey, MarketMetadata>,
    pub trader: Pubkey,
}

/// Unit conversions
impl SDKClientCore {
    /// Given a market pubkey and a number of raw base units, returns the equivalent number of base lots (rounded down).
    pub fn raw_base_units_to_base_lots_rounded_down(
        &self,
        market_key: &Pubkey,
        raw_base_units: f64,
    ) -> Result<u64> {
        self.markets
            .get(market_key)
            .ok_or_else(|| anyhow!("Market not found! Please load in the market first"))
            .map(|m| m.raw_base_units_to_base_lots_rounded_down(raw_base_units))
    }

    /// Given a market pubkey and a number of raw base units, returns the equivalent number of base lots (rounded up).
    pub fn raw_base_units_to_base_lots_rounded_up(
        &self,
        market_key: &Pubkey,
        raw_base_units: f64,
    ) -> Result<u64> {
        self.markets
            .get(market_key)
            .ok_or_else(|| anyhow!("Market not found! Please load in the market first"))
            .map(|m| m.raw_base_units_to_base_lots_rounded_up(raw_base_units))
    }

    /// Given a market pubkey and a number of base atoms, returns the equivalent number of base lots (rounded down).
    pub fn base_atoms_to_base_lots_rounded_down(
        &self,
        market_key: &Pubkey,
        base_atoms: u64,
    ) -> Result<u64> {
        self.markets
            .get(market_key)
            .ok_or_else(|| anyhow!("Market not found! Please load in the market first"))
            .map(|m| m.base_atoms_to_base_lots_rounded_down(base_atoms))
    }

    /// Given a market pubkey and a number of base atoms, returns the equivalent number of base lots (rounded up).
    pub fn base_atoms_to_base_lots_rounded_up(
        &self,
        market_key: &Pubkey,
        base_atoms: u64,
    ) -> Result<u64> {
        self.markets
            .get(market_key)
            .ok_or_else(|| anyhow!("Market not found! Please load in the market first"))
            .map(|m| m.base_atoms_to_base_lots_rounded_up(base_atoms))
    }

    /// Given a market pubkey and a number of base lots, returns the equivalent number of base atoms.
    pub fn base_lots_to_base_atoms(&self, market_key: &Pubkey, base_lots: u64) -> Result<u64> {
        self.markets
            .get(market_key)
            .ok_or_else(|| anyhow!("Market not found! Please load in the market first"))
            .map(|m| m.base_lots_to_base_atoms(base_lots))
    }

    /// Given a market pubkey and a number of quote units, returns the equivalent number of quote lots.
    pub fn quote_units_to_quote_lots(&self, market_key: &Pubkey, quote_units: f64) -> Result<u64> {
        self.markets
            .get(market_key)
            .ok_or_else(|| anyhow!("Market not found! Please load in the market first"))
            .map(|m| m.quote_units_to_quote_lots(quote_units))
    }

    /// Given a market pubkey and a number of quote atoms, returns the equivalent number of quote lots (rounded down).
    pub fn quote_atoms_to_quote_lots_rounded_down(
        &self,
        market_key: &Pubkey,
        quote_atoms: u64,
    ) -> Result<u64> {
        self.markets
            .get(market_key)
            .ok_or_else(|| anyhow!("Market not found! Please load in the market first"))
            .map(|m| m.quote_atoms_to_quote_lots_rounded_down(quote_atoms))
    }

    /// Given a market pubkey and a number of quote atoms, returns the equivalent number of quote lots (rounded up).
    pub fn quote_atoms_to_quote_lots_rounded_up(
        &self,
        market_key: &Pubkey,
        quote_atoms: u64,
    ) -> Result<u64> {
        self.markets
            .get(market_key)
            .ok_or_else(|| anyhow!("Market not found! Please load in the market first"))
            .map(|m| m.quote_atoms_to_quote_lots_rounded_up(quote_atoms))
    }

    /// Given a market pubkey and a number of quote lots, returns the equivalent number of quote atoms.
    pub fn quote_lots_to_quote_atoms(&self, market_key: &Pubkey, quote_lots: u64) -> Result<u64> {
        self.markets
            .get(market_key)
            .ok_or_else(|| anyhow!("Market not found! Please load in the market first"))
            .map(|m| m.quote_lots_to_quote_atoms(quote_lots))
    }

    /// Given a market pubkey and a number of base atoms, returns the equivalent number of raw base units.
    pub fn base_atoms_to_raw_base_units_as_float(
        &self,
        market_key: &Pubkey,
        base_atoms: u64,
    ) -> Result<f64> {
        self.markets
            .get(market_key)
            .ok_or_else(|| anyhow!("Market not found! Please load in the market first"))
            .map(|m| m.base_atoms_to_raw_base_units_as_float(base_atoms))
    }

    /// Given a market pubkey and a number of quote atoms, returns the equivalent number of quote units.
    pub fn quote_atoms_to_quote_units_as_float(
        &self,
        market_key: &Pubkey,
        quote_atoms: u64,
    ) -> Result<f64> {
        self.markets
            .get(market_key)
            .ok_or_else(|| anyhow!("Market not found! Please load in the market first"))
            .map(|m| m.quote_atoms_to_quote_units_as_float(quote_atoms))
    }

    /// Given a market pubkey and a fill event, returns the number of quote atoms filled.
    pub fn fill_event_to_quote_atoms(&self, market_key: &Pubkey, fill: &Fill) -> Result<u64> {
        let &Fill {
            base_lots_filled: base_lots,
            price_in_ticks,
            ..
        } = fill;
        self.base_lots_and_price_to_quote_atoms(market_key, base_lots, price_in_ticks)
    }

    /// Given a market pubkey, number of base lots, and price in ticks, returns the equivalent number of quote atoms
    /// for that price and number of base lots.
    pub fn base_lots_and_price_to_quote_atoms(
        &self,
        market_key: &Pubkey,
        base_lots: u64,
        price_in_ticks: u64,
    ) -> Result<u64> {
        self.markets
            .get(market_key)
            .ok_or_else(|| anyhow!("Market not found! Please load in the market first"))
            .map(|m| m.base_lots_and_price_to_quote_atoms(base_lots, price_in_ticks))
    }

    /// Given a market pubkey and a price in quote units per raw base unit (represented as a float), returns
    /// the corresponding number of ticks (rounded down)
    pub fn float_price_to_ticks_rounded_down(
        &self,
        market_key: &Pubkey,
        price: f64,
    ) -> Result<u64> {
        self.markets
            .get(market_key)
            .ok_or_else(|| anyhow!("Market not found! Please load in the market first"))
            .map(|m| m.float_price_to_ticks_rounded_down(price))
    }

    /// Given a market pubkey and a price in quote units per raw base unit (represented as a float), returns
    /// the corresponding number of ticks (rounded up)
    pub fn float_price_to_ticks_rounded_up(&self, market_key: &Pubkey, price: f64) -> Result<u64> {
        self.markets
            .get(market_key)
            .ok_or_else(|| anyhow!("Market not found! Please load in the market first"))
            .map(|m| m.float_price_to_ticks_rounded_up(price))
    }

    /// Given a number of ticks, returns the corresponding price in quote units per raw base unit (as a float)
    pub fn ticks_to_float_price(&self, market_key: &Pubkey, ticks: u64) -> Result<f64> {
        self.markets
            .get(market_key)
            .ok_or_else(|| anyhow!("Market not found! Please load in the market first"))
            .map(|m| m.ticks_to_float_price(ticks))
    }

    /// Given a market, returns the base lot size in raw base units (as a float)
    pub fn raw_base_units_per_base_lot(&self, market_key: &Pubkey) -> Result<f64> {
        self.markets
            .get(market_key)
            .ok_or_else(|| anyhow!("Market not found! Please load in the market first"))
            .map(|m| m.raw_base_units_per_base_lot())
    }

    /// Given a market, returns the tick size in quote units per raw base unit
    pub fn quote_units_per_raw_base_unit_per_tick(&self, market_key: &Pubkey) -> Result<f64> {
        self.markets
            .get(market_key)
            .ok_or_else(|| anyhow!("Market not found! Please load in the market first"))
            .map(|m| m.quote_units_per_raw_base_unit_per_tick())
    }
}

impl SDKClientCore {
    /// Generate a random client order id
    pub fn get_next_client_order_id(&self, rng: &mut StdRng) -> u128 {
        rng.gen::<u128>()
    }

    pub fn get_market_metadata(&self, market_key: &Pubkey) -> &MarketMetadata {
        match self.markets.get(market_key) {
            Some(market_metadata) => market_metadata,
            None => panic!("Market not found! Please load in the market first."),
        }
    }

    pub fn parse_raw_phoenix_events(
        &self,
        sig: &Signature,
        events: Vec<Vec<u8>>,
    ) -> Option<Vec<RawPhoenixEvent>> {
        let mut market_events: Vec<RawPhoenixEvent> = vec![];

        for event in events.iter() {
            let header_event =
                PhoenixMarketEvent::try_from_slice(&event[..AUDIT_LOG_HEADER_LEN]).ok()?;
            let header = match header_event {
                PhoenixMarketEvent::Header(header) => Some(header),
                _ => {
                    panic!("Expected a header event");
                }
            }?;
            let offset = AUDIT_LOG_HEADER_LEN;
            let mut phoenix_event_bytes = (header.total_events as u32).to_le_bytes().to_vec();
            phoenix_event_bytes.extend_from_slice(&event[offset..]);
            let phoenix_events =
                match Vec::<PhoenixMarketEvent>::try_from_slice(&phoenix_event_bytes) {
                    Ok(v) => v,
                    Err(e) => {
                        println!("Error parsing events: {:?}", e);
                        return None;
                    }
                };

            market_events.push(RawPhoenixEvent {
                header: RawPhoenixHeader {
                    signature: *sig,
                    instruction: header.instruction,
                    sequence_number: header.sequence_number,
                    timestamp: header.timestamp,
                    slot: header.slot,
                    market: header.market,
                    signer: header.signer,
                },
                batch: phoenix_events,
            });
        }

        // This dedupes chunks with the same sequence number into a single list of events
        market_events = market_events
            .iter()
            .group_by(|event| event.header)
            .into_iter()
            .map(|(header, batches)| RawPhoenixEvent {
                header,
                batch: batches
                    .cloned()
                    .flat_map(|event| event.batch)
                    .collect::<Vec<_>>(),
            })
            .collect();

        Some(market_events)
    }

    pub fn parse_events_from_transaction(
        &self,
        tx: &ParsedTransaction,
    ) -> Option<Vec<RawPhoenixEvent>> {
        let sig = Signature::from_str(&tx.signature).ok()?;
        let mut event_list = vec![];
        for inner_ixs in tx.inner_instructions.iter() {
            for inner_ix in inner_ixs.iter() {
                let current_program_id = inner_ix.instruction.program_id.clone();
                if current_program_id != phoenix::id().to_string() {
                    continue;
                }
                if inner_ix.instruction.data.is_empty() {
                    continue;
                }
                let (tag, data) = match inner_ix.instruction.data.split_first() {
                    Some((tag, data)) => (*tag, data),
                    None => continue,
                };
                let ix_enum = match PhoenixInstruction::try_from(tag).ok() {
                    Some(ix) => ix,
                    None => continue,
                };
                if matches!(ix_enum, PhoenixInstruction::Log) {
                    event_list.push(data.to_vec());
                }
            }
        }
        self.parse_raw_phoenix_events(&sig, event_list)
    }
}

/// SDKClientCore instruction builders
impl SDKClientCore {
    pub fn get_ioc_ix(
        &self,
        market_key: &Pubkey,
        price: u64,
        side: Side,
        num_base_lots: u64,
    ) -> Result<Instruction> {
        self.get_ioc_generic_ix(
            market_key,
            price,
            side,
            num_base_lots,
            None,
            None,
            None,
            None,
            None,
            None,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn get_ioc_generic_ix(
        &self,
        market_key: &Pubkey,
        price: u64,
        side: Side,
        num_base_lots: u64,
        self_trade_behavior: Option<SelfTradeBehavior>,
        match_limit: Option<u64>,
        client_order_id: Option<u128>,
        use_only_deposited_funds: Option<bool>,
        last_valid_slot: Option<u64>,
        last_valid_unix_timestamp_in_seconds: Option<u64>,
    ) -> Result<Instruction> {
        let market = self
            .markets
            .get(market_key)
            .ok_or_else(|| anyhow!("Market not found! Please load in the market first."))?;
        let num_quote_ticks_per_base_unit = price / market.tick_size_in_quote_atoms_per_base_unit;
        let self_trade_behavior = self_trade_behavior.unwrap_or(SelfTradeBehavior::CancelProvide);
        let client_order_id = client_order_id.unwrap_or(0);
        let use_only_deposited_funds = use_only_deposited_funds.unwrap_or(false);
        let order_packet = OrderPacket::ImmediateOrCancel {
            side,
            price_in_ticks: Some(Ticks::new(num_quote_ticks_per_base_unit)),
            num_base_lots: BaseLots::new(num_base_lots),
            num_quote_lots: QuoteLots::new(0),
            min_base_lots_to_fill: BaseLots::new(0),
            min_quote_lots_to_fill: QuoteLots::new(0),
            self_trade_behavior,
            match_limit,
            client_order_id,
            use_only_deposited_funds,
            last_valid_slot,
            last_valid_unix_timestamp_in_seconds,
        };
        Ok(create_new_order_instruction(
            &market_key.clone(),
            &self.trader,
            &market.base_mint,
            &market.quote_mint,
            &order_packet,
        ))
    }

    pub fn get_fok_sell_ix(
        &self,
        market_key: &Pubkey,
        price: u64,
        size_in_base_lots: u64,
    ) -> Result<Instruction> {
        self.get_fok_generic_ix(
            market_key,
            price,
            Side::Ask,
            size_in_base_lots,
            None,
            None,
            None,
            None,
        )
    }

    pub fn get_fok_buy_ix(
        &self,
        market_key: &Pubkey,
        price: u64,
        size_in_base_lots: u64,
    ) -> Result<Instruction> {
        self.get_fok_generic_ix(
            market_key,
            price,
            Side::Bid,
            size_in_base_lots,
            None,
            None,
            None,
            None,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn get_fok_buy_generic_ix(
        &self,
        market_key: &Pubkey,
        price: u64,
        size_in_quote_lots: u64,
        self_trade_behavior: Option<SelfTradeBehavior>,
        match_limit: Option<u64>,
        client_order_id: Option<u128>,
        use_only_deposited_funds: Option<bool>,
    ) -> Result<Instruction> {
        self.get_fok_generic_ix(
            market_key,
            price,
            Side::Bid,
            size_in_quote_lots,
            self_trade_behavior,
            match_limit,
            client_order_id,
            use_only_deposited_funds,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn get_fok_sell_generic_ix(
        &self,
        market_key: &Pubkey,
        price: u64,
        size_in_base_lots: u64,
        self_trade_behavior: Option<SelfTradeBehavior>,
        match_limit: Option<u64>,
        client_order_id: Option<u128>,
        use_only_deposited_funds: Option<bool>,
    ) -> Result<Instruction> {
        self.get_fok_generic_ix(
            market_key,
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
    pub fn get_fok_generic_ix(
        &self,
        market_key: &Pubkey,
        price: u64,
        side: Side,
        size: u64,
        self_trade_behavior: Option<SelfTradeBehavior>,
        match_limit: Option<u64>,
        client_order_id: Option<u128>,
        use_only_deposited_funds: Option<bool>,
    ) -> Result<Instruction> {
        let market = self
            .markets
            .get(market_key)
            .ok_or_else(|| anyhow!("Market not found! Please load in the market first."))?;
        let self_trade_behavior = self_trade_behavior.unwrap_or(SelfTradeBehavior::CancelProvide);
        let client_order_id = client_order_id.unwrap_or(0);
        let target_price_in_ticks = price / market.tick_size_in_quote_atoms_per_base_unit;
        let use_only_deposited_funds = use_only_deposited_funds.unwrap_or(false);
        match side {
            Side::Bid => {
                let quote_lot_budget = size / market.quote_atoms_per_quote_lot;
                Ok(create_new_order_instruction(
                    &market_key.clone(),
                    &self.trader,
                    &market.base_mint,
                    &market.quote_mint,
                    &OrderPacket::new_fok_buy_with_limit_price(
                        target_price_in_ticks,
                        quote_lot_budget,
                        self_trade_behavior,
                        match_limit,
                        client_order_id,
                        use_only_deposited_funds,
                    ),
                ))
            }
            Side::Ask => {
                let num_base_lots = size / market.base_atoms_per_base_lot;
                Ok(create_new_order_instruction(
                    &market_key.clone(),
                    &self.trader,
                    &market.base_mint,
                    &market.quote_mint,
                    &OrderPacket::new_fok_sell_with_limit_price(
                        target_price_in_ticks,
                        num_base_lots,
                        self_trade_behavior,
                        match_limit,
                        client_order_id,
                        use_only_deposited_funds,
                    ),
                ))
            }
        }
    }

    pub fn get_ioc_with_slippage_ix(
        &self,
        market_key: &Pubkey,
        lots_in: u64,
        min_lots_out: u64,
        side: Side,
    ) -> Result<Instruction> {
        let market = self
            .markets
            .get(market_key)
            .ok_or_else(|| anyhow!("Market not found! Please load in the market first."))?;
        let order_type = match side {
            Side::Bid => OrderPacket::new_ioc_buy_with_slippage(lots_in, min_lots_out),
            Side::Ask => OrderPacket::new_ioc_sell_with_slippage(lots_in, min_lots_out),
        };

        Ok(create_new_order_instruction(
            &market_key.clone(),
            &self.trader,
            &market.base_mint,
            &market.quote_mint,
            &order_type,
        ))
    }

    pub fn get_ioc_from_tick_price_ix(
        &self,
        market_key: &Pubkey,
        tick_price: u64,
        side: Side,
        size: u64,
    ) -> Result<Instruction> {
        let market = self
            .markets
            .get(market_key)
            .ok_or_else(|| anyhow!("Market not found! Please load in the market first."))?;
        Ok(create_new_order_instruction(
            &market_key.clone(),
            &self.trader,
            &market.base_mint,
            &market.quote_mint,
            &OrderPacket::new_ioc_by_lots(
                side,
                tick_price,
                size,
                SelfTradeBehavior::CancelProvide,
                None,
                0,
                false,
            ),
        ))
    }

    pub fn get_post_only_ix(
        &self,
        market_key: &Pubkey,
        price: u64,
        side: Side,
        size: u64,
    ) -> Result<Instruction> {
        self.get_post_only_generic_ix(
            market_key, price, side, size, None, None, None, None, None, None,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn get_post_only_generic_ix(
        &self,
        market_key: &Pubkey,
        price: u64,
        side: Side,
        size: u64,
        client_order_id: Option<u128>,
        reject_post_only: Option<bool>,
        use_only_deposited_funds: Option<bool>,
        last_valid_slot: Option<u64>,
        last_valid_unix_timestamp_in_seconds: Option<u64>,
        fail_silently_on_insufficient_funds: Option<bool>,
    ) -> Result<Instruction> {
        let market = self
            .markets
            .get(market_key)
            .ok_or_else(|| anyhow!("Market not found! Please load in the market first."))?;
        let price_in_ticks = price / market.tick_size_in_quote_atoms_per_base_unit;
        let client_order_id = client_order_id.unwrap_or(0);
        let reject_post_only = reject_post_only.unwrap_or(false);
        let use_only_deposited_funds = use_only_deposited_funds.unwrap_or(false);
        let fail_silently_on_insufficient_funds =
            fail_silently_on_insufficient_funds.unwrap_or(false);
        let order_packet = OrderPacket::PostOnly {
            side,
            price_in_ticks: Ticks::new(price_in_ticks),
            num_base_lots: BaseLots::new(size),
            client_order_id,
            reject_post_only,
            use_only_deposited_funds,
            last_valid_slot,
            last_valid_unix_timestamp_in_seconds,
            fail_silently_on_insufficient_funds,
        };
        Ok(create_new_order_instruction(
            &market_key.clone(),
            &self.trader,
            &market.base_mint,
            &market.quote_mint,
            &order_packet,
        ))
    }

    pub fn get_post_only_ix_from_tick_price(
        &self,
        market_key: &Pubkey,
        tick_price: u64,
        side: Side,
        size: u64,
        client_order_id: u128,
        improve_price_on_cross: bool,
    ) -> Result<Instruction> {
        let market = self
            .markets
            .get(market_key)
            .ok_or_else(|| anyhow!("Market not found! Please load in the market first."))?;
        Ok(create_new_order_instruction(
            &market_key.clone(),
            &self.trader,
            &market.base_mint,
            &market.quote_mint,
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
        ))
    }

    pub fn get_limit_order_ix(
        &self,
        market_key: &Pubkey,
        price: u64,
        side: Side,
        size: u64,
    ) -> Result<Instruction> {
        self.get_limit_order_generic_ix(
            market_key, price, side, size, None, None, None, None, None, None, None,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn get_limit_order_generic_ix(
        &self,
        market_key: &Pubkey,
        price: u64,
        side: Side,
        size: u64,
        self_trade_behavior: Option<SelfTradeBehavior>,
        match_limit: Option<u64>,
        client_order_id: Option<u128>,
        use_only_deposited_funds: Option<bool>,
        last_valid_slot: Option<u64>,
        last_valid_unix_timestamp_in_seconds: Option<u64>,
        fail_silently_on_insufficient_funds: Option<bool>,
    ) -> Result<Instruction> {
        let market = self
            .markets
            .get(market_key)
            .ok_or_else(|| anyhow!("Market not found! Please load in the market first."))?;
        let num_quote_ticks_per_base_unit = price / market.tick_size_in_quote_atoms_per_base_unit;
        let self_trade_behavior = self_trade_behavior.unwrap_or(SelfTradeBehavior::DecrementTake);
        let client_order_id = client_order_id.unwrap_or(0);
        let use_only_deposited_funds = use_only_deposited_funds.unwrap_or(false);
        let fail_silently_on_insufficient_funds =
            fail_silently_on_insufficient_funds.unwrap_or(false);
        let order_packet = OrderPacket::Limit {
            side,
            price_in_ticks: Ticks::new(num_quote_ticks_per_base_unit),
            num_base_lots: BaseLots::new(size),
            self_trade_behavior,
            match_limit,
            client_order_id,
            use_only_deposited_funds,
            last_valid_slot,
            last_valid_unix_timestamp_in_seconds,
            fail_silently_on_insufficient_funds,
        };
        Ok(create_new_order_instruction(
            &market_key.clone(),
            &self.trader,
            &market.base_mint,
            &market.quote_mint,
            &order_packet,
        ))
    }

    pub fn get_limit_order_ix_from_tick_price(
        &self,
        market_key: &Pubkey,
        tick_price: u64,
        side: Side,
        size: u64,
        client_order_id: u128,
    ) -> Result<Instruction> {
        let market = self
            .markets
            .get(market_key)
            .ok_or_else(|| anyhow!("Market not found! Please load in the market first."))?;
        Ok(create_new_order_instruction(
            &market_key.clone(),
            &self.trader,
            &market.base_mint,
            &market.quote_mint,
            &OrderPacket::new_limit_order_default_with_client_order_id(
                side,
                tick_price,
                size,
                client_order_id,
            ),
        ))
    }

    pub fn get_cancel_ids_ix(
        &self,
        market_key: &Pubkey,
        ids: Vec<FIFOOrderId>,
    ) -> Result<Instruction> {
        let market = self
            .markets
            .get(market_key)
            .ok_or_else(|| anyhow!("Market not found! Please load in the market first."))?;
        let mut cancel_orders = vec![];
        for &FIFOOrderId {
            price_in_ticks,
            order_sequence_number,
            ..
        } in ids.iter()
        {
            cancel_orders.push(CancelOrderParams {
                side: Side::from_order_sequence_number(order_sequence_number),
                price_in_ticks: price_in_ticks.as_u64(),
                order_sequence_number,
            });
        }
        let cancel_multiple_orders = CancelMultipleOrdersByIdParams {
            orders: cancel_orders,
        };

        Ok(create_cancel_multiple_orders_by_id_instruction(
            &market_key.clone(),
            &self.trader,
            &market.base_mint,
            &market.quote_mint,
            &cancel_multiple_orders,
        ))
    }

    pub fn get_cancel_up_to_ix(
        &self,
        market_key: &Pubkey,
        tick_limit: Option<u64>,
        side: Side,
    ) -> Result<Instruction> {
        let market = self
            .markets
            .get(market_key)
            .ok_or_else(|| anyhow!("Market not found! Please load in the market first."))?;
        let params = CancelUpToParams {
            side,
            tick_limit,
            num_orders_to_search: None,
            num_orders_to_cancel: None,
        };

        Ok(create_cancel_up_to_instruction(
            &market_key.clone(),
            &self.trader,
            &market.base_mint,
            &market.quote_mint,
            &params,
        ))
    }

    pub fn get_cancel_all_ix(&self, market_key: &Pubkey) -> Result<Instruction> {
        let market = self
            .markets
            .get(market_key)
            .ok_or_else(|| anyhow!("Market not found! Please load in the market first."))?;
        Ok(create_cancel_all_orders_instruction(
            &market_key.clone(),
            &self.trader,
            &market.base_mint,
            &market.quote_mint,
        ))
    }

    pub fn get_withdraw_ix(&self, market_key: &Pubkey) -> Result<Instruction> {
        let market = self
            .markets
            .get(market_key)
            .ok_or_else(|| anyhow!("Market not found! Please load in the market first."))?;
        Ok(create_withdraw_funds_instruction(
            &market_key.clone(),
            &self.trader,
            &market.base_mint,
            &market.quote_mint,
        ))
    }
}
