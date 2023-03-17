use anyhow::anyhow;
use anyhow::Result;
use borsh::BorshDeserialize;
use phoenix::program::PhoenixInstruction;
use phoenix::quantities::QuoteLots;
use phoenix::{
    program::events::PhoenixMarketEvent,
    program::instruction_builders::{
        create_cancel_all_orders_instruction, create_cancel_multiple_orders_by_id_instruction,
        create_cancel_up_to_instruction, create_new_order_instruction,
    },
    program::{
        cancel_multiple_orders::{CancelMultipleOrdersByIdParams, CancelUpToParams},
        EvictEvent, ExpiredOrderEvent, FeeEvent, FillEvent, FillSummaryEvent, PlaceEvent,
        TimeInForceEvent,
    },
    program::{reduce_order::CancelOrderParams, ReduceEvent},
    quantities::{BaseLots, Ticks, WrapperU64},
    state::enums::{SelfTradeBehavior, Side},
    state::markets::FIFOOrderId,
    state::order_packet::OrderPacket,
    state::trader_state::TraderState,
};
use ellipsis_client::transaction_utils::ParsedTransaction;
use rand::{rngs::StdRng, Rng};
use solana_program::{instruction::Instruction, pubkey::Pubkey};
use solana_sdk::signature::Signature;
use std::{
    collections::BTreeMap,
    fmt::Display,
    ops::{Div, Rem},
};

use crate::{
    market_event::{
        Evict, Fill, FillSummary, MarketEventDetails, PhoenixEvent, Place, Reduce, TimeInForce,
    },
    orderbook::Orderbook,
};

const AUDIT_LOG_HEADER_LEN: usize = 92;

pub struct MarketState {
    /// State of the bids and offers in the market.
    pub orderbook: Orderbook<FIFOOrderId, PhoenixOrder>,
    /// Authorized makers in the market.
    pub traders: BTreeMap<Pubkey, TraderState>,
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
    pub base_multiplier: u64,
    /// 10^quote_decimals
    pub quote_multiplier: u64,
    pub quote_lot_size: u64,
    pub base_lot_size: u64,
    pub tick_size_in_quote_atoms_per_base_unit: u64,
    pub num_base_lots_per_base_unit: u64,
    /// The adjustment factor to convert from the raw base unit (i.e. 1 BONK token) to the Phoenix BaseUnit (which may be a multiple of whole tokens).
    /// The adjustment factor is almost always 1, unless one base token is worth less than one quote atom (i.e. 1e-6 USDC)
    pub raw_base_units_per_base_unit: u32,
}
pub struct SDKClientCore {
    pub markets: BTreeMap<Pubkey, MarketMetadata>,
    pub trader: Pubkey,
}

impl SDKClientCore {
    /// RECOMMENDED:
    /// Converts raw base units (whole tokens) to base lots. For example if the base currency was a Widget and you wanted to
    /// convert 3 Widget tokens to base lots you would call sdk.raw_base_units_to_base_lots(3.0). This would return
    /// the number of base lots that would be equivalent to 3 Widget tokens.
    pub fn raw_base_units_to_base_lots(
        &self,
        market_key: &Pubkey,
        raw_base_units: f64,
    ) -> Result<u64> {
        let market = self
            .markets
            .get(market_key)
            .ok_or(anyhow!("Market not found! Please load in the market first"))?;
        // Convert to Phoenix BaseUnits
        let base_units = raw_base_units / market.raw_base_units_per_base_unit as f64;
        Ok((base_units * (market.num_base_lots_per_base_unit as f64)).floor() as u64)
    }

    /// The same function as raw_base_units_to_base_lots, but rounds up instead of down.
    pub fn raw_base_units_to_base_lots_rounded_up(
        &self,
        market_key: &Pubkey,
        raw_base_units: f64,
    ) -> Result<u64> {
        let market = self
            .markets
            .get(market_key)
            .ok_or(anyhow!("Market not found! Please load in the market first"))?;
        // Convert to Phoenix BaseUnits
        let base_units = raw_base_units / market.raw_base_units_per_base_unit as f64;
        Ok((base_units * (market.num_base_lots_per_base_unit as f64)).ceil() as u64)
    }

    /// RECOMMENDED:
    /// Converts base atoms to base lots. For example if the base currency was a Widget with 9 decimals, where 1 atom is 1e-9 of one Widget and you wanted to
    /// convert 3 Widgets to base lots you would call sdk.base_amount_to_base_lots(3_000_000_000). This would return
    /// the number of base lots that would be equivalent to 3 Widgets or 3 * 1e9 Widget atoms.
    pub fn base_atoms_to_base_lots(&self, market_key: &Pubkey, base_atoms: u64) -> Result<u64> {
        let market = self.markets.get(market_key).ok_or(anyhow!(
            "Market not found! Please load in the market first."
        ))?;

        Ok(base_atoms / market.base_lot_size) // Lot size is the number of atoms in a lot
    }

    /// RECOMMENDED:
    /// Converts base lots to base atoms. For example if the base currency was a Widget where there are
    /// 1_000 base atoms per base lot of Widget, you would call sdk.base_lots_to_base_atoms(300) to convert 300 base lots
    /// to 300_000 Widget atoms.
    pub fn base_lots_to_base_atoms(&self, market_key: &Pubkey, base_lots: u64) -> Result<u64> {
        let market = self.markets.get(market_key).ok_or(anyhow!(
            "Market not found! Please load in the market first."
        ))?;
        Ok(base_lots * market.base_lot_size) // Lot size is the number of atoms in a lot
    }

    /// RECOMMENDED:
    /// Converts quote units to quote lots. For example if the quote currency was USDC you wanted to
    /// convert 3 USDC to quote lots you would call sdk.quote_unit_to_quote_lots(3.0). This would return
    /// the number of quote lots that would be equivalent to 3 USDC.
    pub fn quote_units_to_quote_lots(&self, market_key: &Pubkey, quote_units: f64) -> Result<u64> {
        let market = self.markets.get(market_key).ok_or(anyhow!(
            "Market not found! Please load in the market first."
        ))?;
        Ok((quote_units * market.quote_multiplier as f64 / market.quote_lot_size as f64) as u64)
    }

    /// RECOMMENDED:
    /// Converts quote atoms to quote lots. For example if the quote currency was USDC with 6 decimals and you wanted to
    /// convert 3 USDC, or 3_000_000 USDC atoms, to quote lots you would call sdk.quote_atoms_to_quote_lots(3_000_000). This would return
    /// the number of quote lots that would be equivalent to 3_000_000 USDC atoms.
    pub fn quote_atoms_to_quote_lots(&self, market_key: &Pubkey, quote_atoms: u64) -> Result<u64> {
        let market = self.markets.get(market_key).ok_or(anyhow!(
            "Market not found! Please load in the market first."
        ))?;
        Ok(quote_atoms / market.quote_lot_size)
    }

    /// RECOMMENDED:
    /// Converts quote lots to quote atoms. For example if the quote currency was USDC and there are
    /// 100 quote atoms per quote lot of USDC, you would call sdk.quote_lots_to_quote_atoms(300) to convert 300 quote lots
    /// to 30_000 USDC atoms.
    pub fn quote_lots_to_quote_atoms(&self, market_key: &Pubkey, quote_lots: u64) -> Result<u64> {
        let market = self.markets.get(market_key).ok_or(anyhow!(
            "Market not found! Please load in the market first."
        ))?;
        Ok(quote_lots * market.quote_lot_size)
    }

    /// Converts a number of base atoms to a floating point number of base units. For example if the base currency
    /// is a Widget where the token has 9 decimals and you wanted to convert 1_000_000_000 base atoms to
    /// a floating point number of whole Widget tokens you would call sdk.base_amount_to_float(1_000_000_000). This
    /// would return 1.0. This is useful for displaying the base amount in a human readable format.
    pub fn base_atoms_to_base_unit_as_float(
        &self,
        market_key: &Pubkey,
        base_atoms: u64,
    ) -> Result<f64> {
        let market = self.markets.get(market_key).ok_or(anyhow!(
            "Market not found! Please load in the market first."
        ))?;
        Ok(base_atoms as f64 / market.base_multiplier as f64)
    }

    /// Converts a number of quote atoms to a floating point number of quote units. For example if the quote currency
    /// is USDC the token has 6 decimals and you wanted to convert 1_000_000 USDC atoms to
    /// a floating point number of whole USDC tokens you would call sdk.quote_amount_to_float(1_000_000). This
    /// would return 1.0. This is useful for displaying the quote amount in a human readable format.
    pub fn quote_atoms_to_quote_unit_as_float(
        &self,
        market_key: &Pubkey,
        quote_atoms: u64,
    ) -> Result<f64> {
        let market = self.markets.get(market_key).ok_or(anyhow!(
            "Market not found! Please load in the market first."
        ))?;
        Ok(quote_atoms as f64 / market.quote_multiplier as f64)
    }

    /// Takes in a number of quote atoms, converts to floating point number of whole tokens, and prints it as a human readable string to the console
    pub fn print_quote_amount(&self, market_key: &Pubkey, quote_amount: u64) -> Result<()> {
        let market = self.markets.get(market_key).ok_or(anyhow!(
            "Market not found! Please load in the market first."
        ))?;
        println!(
            "{}",
            get_decimal_string(quote_amount, market.quote_decimals)
        );
        Ok(())
    }

    /// Takes in a number of base atoms, converts to floating point number of whole tokens, and prints it as a human readable string to the console
    pub fn print_base_amount(&self, market_key: &Pubkey, base_amount: u64) -> Result<()> {
        let market = self.markets.get(market_key).ok_or(anyhow!(
            "Market not found! Please load in the market first."
        ))?;
        println!("{}", get_decimal_string(base_amount, market.base_decimals));
        Ok(())
    }

    /// Takes in information from a fill event and converts it into the equivalent quote amount
    pub fn fill_event_to_quote_amount(&self, market_key: &Pubkey, fill: &Fill) -> Result<u64> {
        let &Fill {
            base_lots_filled: base_lots,
            price_in_ticks,
            ..
        } = fill;
        self.order_to_quote_amount(market_key, base_lots, price_in_ticks)
    }

    /// Takes in tick price and base lots of an order converts it into the equivalent quote amount
    pub fn order_to_quote_amount(
        &self,
        market_key: &Pubkey,
        base_lots: u64,
        price_in_ticks: u64,
    ) -> Result<u64> {
        let market = self.markets.get(market_key).ok_or(anyhow!(
            "Market not found! Please load in the market first."
        ))?;
        Ok(
            base_lots * price_in_ticks * market.tick_size_in_quote_atoms_per_base_unit
                / market.num_base_lots_per_base_unit,
        )
    }

    /// Takes in a price as a floating point number and converts it to a number of ticks (rounded down)
    pub fn float_price_to_ticks(&self, market_key: &Pubkey, price: f64) -> Result<u64> {
        let market = self.markets.get(market_key).ok_or(anyhow!(
            "Market not found! Please load in the market first."
        ))?;
        Ok(
            ((price * market.raw_base_units_per_base_unit as f64 * market.quote_multiplier as f64)
                / market.tick_size_in_quote_atoms_per_base_unit as f64) as u64,
        )
    }

    /// Takes in a price as a floating point number and converts it to a number of ticks (rounded up)
    pub fn float_price_to_ticks_rounded_up(&self, market_key: &Pubkey, price: f64) -> Result<u64> {
        let market = self.markets.get(market_key).ok_or(anyhow!(
            "Market not found! Please load in the market first."
        ))?;
        Ok(
            ((price * market.raw_base_units_per_base_unit as f64 * market.quote_multiplier as f64)
                / market.tick_size_in_quote_atoms_per_base_unit as f64)
                .ceil() as u64,
        )
    }

    /// Takes in a number of ticks and converts it to a floating point number price
    pub fn ticks_to_float_price(&self, market_key: &Pubkey, ticks: u64) -> Result<f64> {
        let market = self.markets.get(market_key).ok_or(anyhow!(
            "Market not found! Please load in the market first."
        ))?;
        Ok(
            (ticks as f64 * market.tick_size_in_quote_atoms_per_base_unit as f64)
                / market.quote_multiplier as f64,
        )
    }

    /// Multiplier used to convert base lots to base units
    pub fn base_lots_to_base_units_multiplier(&self, market_key: &Pubkey) -> Result<f64> {
        let market = self.markets.get(market_key).ok_or(anyhow!(
            "Market not found! Please load in the market first."
        ))?;
        Ok(1.0 / market.num_base_lots_per_base_unit as f64)
    }

    /// Multiplier used to convert ticks to a floating point number price
    pub fn ticks_to_float_price_multiplier(&self, market_key: &Pubkey) -> Result<f64> {
        let market = self.markets.get(market_key).ok_or(anyhow!(
            "Market not found! Please load in the market first."
        ))?;
        Ok(market.tick_size_in_quote_atoms_per_base_unit as f64 / market.quote_multiplier as f64)
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

    pub fn parse_phoenix_events(
        &self,
        market_key: &Pubkey,
        sig: &Signature,
        events: Vec<Vec<u8>>,
    ) -> Option<Vec<PhoenixEvent>> {
        let market = self.markets.get(market_key)?;
        let mut market_events: Vec<PhoenixEvent> = vec![];

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
            let mut trade_direction = None;
            for phoenix_event in phoenix_events {
                match phoenix_event {
                    PhoenixMarketEvent::Fill(FillEvent {
                        index,
                        maker_id,
                        order_sequence_number,
                        price_in_ticks,
                        base_lots_filled,
                        base_lots_remaining,
                    }) => {
                        let side_filled = Side::from_order_sequence_number(order_sequence_number);
                        market_events.push(PhoenixEvent {
                            market: header.market,
                            sequence_number: header.sequence_number,
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
                        });
                        if trade_direction.is_none() {
                            trade_direction = match side_filled {
                                Side::Bid => Some(-1),
                                Side::Ask => Some(1),
                            }
                        }
                    }
                    PhoenixMarketEvent::Reduce(ReduceEvent {
                        index,
                        order_sequence_number,
                        price_in_ticks,
                        base_lots_removed,
                        base_lots_remaining,
                    }) => market_events.push(PhoenixEvent {
                        market: header.market,
                        sequence_number: header.sequence_number,
                        slot: header.slot,
                        timestamp: header.timestamp,
                        signature: *sig,
                        signer: header.signer,
                        event_index: index as u64,
                        details: MarketEventDetails::Reduce(Reduce {
                            order_sequence_number,
                            maker: header.signer,
                            price_in_ticks,
                            base_lots_removed,
                            base_lots_remaining,
                            is_full_cancel: base_lots_remaining == 0,
                        }),
                    }),

                    PhoenixMarketEvent::Place(PlaceEvent {
                        index,
                        order_sequence_number,
                        client_order_id,
                        price_in_ticks,
                        base_lots_placed,
                    }) => market_events.push(PhoenixEvent {
                        market: header.market,
                        sequence_number: header.sequence_number,
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
                    PhoenixMarketEvent::Evict(EvictEvent {
                        index,
                        maker_id,
                        order_sequence_number,
                        price_in_ticks,
                        base_lots_evicted,
                    }) => market_events.push(PhoenixEvent {
                        market: header.market,
                        sequence_number: header.sequence_number,
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
                    PhoenixMarketEvent::FillSummary(FillSummaryEvent {
                        index,
                        client_order_id,
                        total_base_lots_filled,
                        total_quote_lots_filled,
                        total_fee_in_quote_lots,
                    }) => market_events.push(PhoenixEvent {
                        market: header.market,
                        sequence_number: header.sequence_number,
                        slot: header.slot,
                        timestamp: header.timestamp,
                        signature: *sig,
                        signer: header.signer,
                        event_index: index as u64,
                        details: MarketEventDetails::FillSummary(FillSummary {
                            client_order_id,
                            total_base_filled: total_base_lots_filled * market.base_lot_size,
                            total_quote_filled_including_fees: total_quote_lots_filled
                                * market.quote_lot_size,
                            total_quote_fees: total_fee_in_quote_lots * market.quote_lot_size,
                            trade_direction: trade_direction.unwrap_or(0),
                        }),
                    }),
                    PhoenixMarketEvent::Fee(FeeEvent {
                        index,
                        fees_collected_in_quote_lots,
                    }) => market_events.push(PhoenixEvent {
                        market: header.market,
                        sequence_number: header.sequence_number,
                        slot: header.slot,
                        timestamp: header.timestamp,
                        signature: *sig,
                        signer: header.signer,
                        event_index: index as u64,
                        details: MarketEventDetails::Fee(
                            fees_collected_in_quote_lots * market.quote_lot_size,
                        ),
                    }),
                    PhoenixMarketEvent::TimeInForce(TimeInForceEvent {
                        index,
                        order_sequence_number,
                        last_valid_slot,
                        last_valid_unix_timestamp_in_seconds,
                    }) => market_events.push(PhoenixEvent {
                        market: header.market,
                        sequence_number: header.sequence_number,
                        slot: header.slot,
                        timestamp: header.timestamp,
                        signature: *sig,
                        signer: header.signer,
                        event_index: index as u64,
                        details: MarketEventDetails::TimeInForce(TimeInForce {
                            order_sequence_number,
                            last_valid_slot,
                            last_valid_unix_timestamp_in_seconds,
                        }),
                    }),
                    PhoenixMarketEvent::ExpiredOrder(ExpiredOrderEvent {
                        index,
                        maker_id,
                        order_sequence_number,
                        price_in_ticks,
                        base_lots_removed,
                    }) => market_events.push(PhoenixEvent {
                        market: header.market,
                        sequence_number: header.sequence_number,
                        slot: header.slot,
                        timestamp: header.timestamp,
                        signature: *sig,
                        signer: header.signer,
                        event_index: index as u64,
                        details: MarketEventDetails::Reduce(Reduce {
                            order_sequence_number,
                            maker: maker_id,
                            price_in_ticks,
                            base_lots_removed,
                            base_lots_remaining: 0,
                            is_full_cancel: true,
                        }),
                    }),
                    _ => {
                        println!("Unknown event: {:?}", phoenix_event);
                    }
                }
            }
        }
        Some(market_events)
    }

    pub fn parse_events_from_transaction(
        &self,
        market_key: &Pubkey,
        sig: &Signature,
        tx: &ParsedTransaction,
    ) -> Option<Vec<PhoenixEvent>> {
        
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
        self.parse_phoenix_events(market_key, sig, event_list)
    }
    

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
        let market = self.markets.get(market_key).ok_or(anyhow!(
            "Market not found! Please load in the market first."
        ))?;
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
        let market = self.markets.get(market_key).ok_or(anyhow!(
            "Market not found! Please load in the market first."
        ))?;
        let self_trade_behavior = self_trade_behavior.unwrap_or(SelfTradeBehavior::CancelProvide);
        let client_order_id = client_order_id.unwrap_or(0);
        let target_price_in_ticks = price / market.tick_size_in_quote_atoms_per_base_unit;
        let use_only_deposited_funds = use_only_deposited_funds.unwrap_or(false);
        match side {
            Side::Bid => {
                let quote_lot_budget = size / market.quote_lot_size;
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
                let num_base_lots = size / market.base_lot_size;
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
        let market = self.markets.get(market_key).ok_or(anyhow!(
            "Market not found! Please load in the market first."
        ))?;
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
        let market = self.markets.get(market_key).ok_or(anyhow!(
            "Market not found! Please load in the market first."
        ))?;
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
        self.get_post_only_generic_ix(market_key, price, side, size, None, None, None, None, None)
    }

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
    ) -> Result<Instruction> {
        let market = self.markets.get(market_key).ok_or(anyhow!(
            "Market not found! Please load in the market first."
        ))?;
        let price_in_ticks = price / market.tick_size_in_quote_atoms_per_base_unit;
        let client_order_id = client_order_id.unwrap_or(0);
        let reject_post_only = reject_post_only.unwrap_or(false);
        let use_only_deposited_funds = use_only_deposited_funds.unwrap_or(false);
        let order_packet = OrderPacket::PostOnly {
            side,
            price_in_ticks: Ticks::new(price_in_ticks),
            num_base_lots: BaseLots::new(size),
            client_order_id,
            reject_post_only,
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

    pub fn get_post_only_ix_from_tick_price(
        &self,
        market_key: &Pubkey,
        tick_price: u64,
        side: Side,
        size: u64,
        client_order_id: u128,
        improve_price_on_cross: bool,
    ) -> Result<Instruction> {
        let market = self.markets.get(market_key).ok_or(anyhow!(
            "Market not found! Please load in the market first."
        ))?;
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
            market_key, price, side, size, None, None, None, None, None, None,
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
    ) -> Result<Instruction> {
        let market = self.markets.get(market_key).ok_or(anyhow!(
            "Market not found! Please load in the market first."
        ))?;
        let num_quote_ticks_per_base_unit = price / market.tick_size_in_quote_atoms_per_base_unit;
        let self_trade_behavior = self_trade_behavior.unwrap_or(SelfTradeBehavior::DecrementTake);
        let client_order_id = client_order_id.unwrap_or(0);
        let use_only_deposited_funds = use_only_deposited_funds.unwrap_or(false);
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
        let market = self.markets.get(market_key).ok_or(anyhow!(
            "Market not found! Please load in the market first."
        ))?;
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
        let market = self.markets.get(market_key).ok_or(anyhow!(
            "Market not found! Please load in the market first."
        ))?;
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
        let market = self.markets.get(market_key).ok_or(anyhow!(
            "Market not found! Please load in the market first."
        ))?;
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
        let market = self.markets.get(market_key).ok_or(anyhow!(
            "Market not found! Please load in the market first."
        ))?;
        Ok(create_cancel_all_orders_instruction(
            &market_key.clone(),
            &self.trader,
            &market.base_mint,
            &market.quote_mint,
        ))
    }
}
