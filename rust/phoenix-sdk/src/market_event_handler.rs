use phoenix_types::enums::Side;
use solana_program::{instruction::Instruction, pubkey::Pubkey};
use solana_sdk::signature::Signature;
use std::sync::mpsc::Sender;

#[derive(Clone, Debug)]
pub enum SDKMarketEvent {
    PhoenixEvent { event: Box<PhoenixEvent> },
    FairPriceUpdate { price: f64 },
    RefreshEvent,
}

#[derive(Clone, Copy, Debug)]
pub struct PhoenixEvent {
    /// The pubkey of the market the trade occurred in
    pub market: Pubkey,
    /// The sequence number of the trade event.
    pub sequence_number: u64,
    /// The slot of the trade event.
    pub slot: u64,
    /// The timestamp of the trade event.
    pub timestamp: i64,
    /// The signature of the transaction that contains this event.
    pub signature: Signature,
    /// The signer of the transaction that contains this event.
    pub signer: Pubkey,
    /// The index of the trade in the list of trade_events.
    pub event_index: u64,
    /// Details of the event that are specific to the event type.
    pub details: MarketEventDetails,
}

#[derive(Clone, Copy, Debug)]
pub enum MarketEventDetails {
    Fill(Fill),
    Place(Place),
    Evict(Evict),
    Reduce(Reduce),
    FillSummary(FillSummary),
}

#[derive(Clone, Copy, Debug)]
pub struct Fill {
    /// The sequence number of the order that was filled.
    pub order_sequence_number: u64,
    /// The pubkey of the maker.
    pub maker: Pubkey,
    /// The pubkey of the taker.
    pub taker: Pubkey,
    /// The quote ticks per base unit of the order.
    pub price_in_ticks: u64,
    /// The number of lots that were filled in the order.
    pub base_lots_filled: u64,
    /// The number of lots that remain in the order.
    pub base_lots_remaining: u64,
    /// The side of the order that was filled.
    pub side_filled: Side,
    /// Whether the order was fully filled.
    pub is_full_fill: bool,
}

#[derive(Clone, Copy, Debug)]
pub struct Place {
    /// The sequence number of the order that was placed.
    pub order_sequence_number: u64,
    /// The client_order_id of the order that was placed.
    pub client_order_id: u128,
    /// The pubkey of the maker.
    pub maker: Pubkey,
    /// The quote ticks per base unit of the order.
    pub price_in_ticks: u64,
    /// The number of lots that were placed in the order.
    pub base_lots_placed: u64,
}

#[derive(Clone, Copy, Debug)]
pub struct Reduce {
    /// The sequence number of the order that was reduced.
    pub order_sequence_number: u64,
    /// The pubkey of the maker.
    pub maker: Pubkey,
    /// The quote ticks per base unit of the order.
    pub price_in_ticks: u64,
    /// The number of lots that remain in the order.
    pub base_lots_remaining: u64,
    /// Whether the order was fully canceled.
    pub is_full_cancel: bool,
}

#[derive(Clone, Copy, Debug)]
pub struct Evict {
    /// The sequence number of the order that was evicted.
    pub order_sequence_number: u64,
    /// The pubkey of the maker whose order was evicted.
    pub maker: Pubkey,
    /// The price of the order, in quote ticks per base unit
    pub price_in_ticks: u64,
    /// The number of lots that were forcibly removed from the book.
    pub base_lots_evicted: u64,
}

#[derive(Clone, Copy, Debug)]
pub struct FillSummary {
    /// The client_order_id of the order that was filled.
    pub client_order_id: u128,
    /// The total base quantity that was filled.
    pub total_base_filled: u64,
    /// The total quote quantity that was filled including fees.
    pub total_quote_filled_including_fees: u64,
    /// The total quote quantity fees that were paid.
    pub total_quote_fees: u64,
}

pub trait MarketEventHandler<T> {
    /// Called when a transaction with multiple events is processed
    /// Clients should override this method to build specific logic for handling
    /// new transactions
    fn handle_events(
        &mut self,
        sender: &Sender<T>,
        events: Vec<PhoenixEvent>,
    ) -> anyhow::Result<()> {
        for event in events.iter() {
            match event.details {
                MarketEventDetails::Fill(..) => {
                    self.handle_trade(sender, event)?;
                }
                MarketEventDetails::Evict(..)
                | MarketEventDetails::Place(..)
                | MarketEventDetails::Reduce(..) => {
                    self.handle_orderbook_update(sender, event)?;
                }
                MarketEventDetails::FillSummary(..) => {
                    self.handle_fill_summary(sender, event)?;
                }
            }
        }
        Ok(())
    }

    fn handle_trade(&mut self, sender: &Sender<T>, update: &PhoenixEvent) -> anyhow::Result<()>;

    fn handle_fill_summary(
        &mut self,
        sender: &Sender<T>,
        update: &PhoenixEvent,
    ) -> anyhow::Result<()>;

    fn handle_orderbook_update(
        &mut self,
        sender: &Sender<T>,
        update: &PhoenixEvent,
    ) -> anyhow::Result<()>;
}

pub struct LogHandler;
unsafe impl Send for LogHandler {}

impl MarketEventHandler<Vec<Instruction>> for LogHandler {
    fn handle_trade(
        &mut self,
        _sender: &Sender<Vec<Instruction>>,
        update: &PhoenixEvent,
    ) -> anyhow::Result<()> {
        println!("Trade: {:?}", update);
        Ok(())
    }

    fn handle_orderbook_update(
        &mut self,
        _sender: &Sender<Vec<Instruction>>,
        update: &PhoenixEvent,
    ) -> anyhow::Result<()> {
        println!("Orderbook Update: {:?}", update);
        Ok(())
    }

    fn handle_fill_summary(
        &mut self,
        _sender: &Sender<Vec<Instruction>>,
        update: &PhoenixEvent,
    ) -> anyhow::Result<()> {
        println!("Fill Summary: {:?}", update);
        Ok(())
    }
}
