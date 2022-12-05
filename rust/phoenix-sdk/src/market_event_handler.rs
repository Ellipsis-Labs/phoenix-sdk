pub use phoenix_sdk_core::market_event::{Fill, MarketEventDetails, PhoenixEvent};
use solana_program::instruction::Instruction;
use std::sync::mpsc::Sender;

#[derive(Clone, Debug)]
pub enum SDKMarketEvent {
    PhoenixEvent { event: Box<PhoenixEvent> },
    FairPriceUpdate { price: f64 },
    RefreshEvent,
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
                MarketEventDetails::Fee(..) => {
                    // Ignore fee events
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
