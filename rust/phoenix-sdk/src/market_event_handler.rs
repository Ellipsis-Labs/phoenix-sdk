use async_trait::async_trait;
pub use phoenix_sdk_core::market_event::{Fill, MarketEventDetails, PhoenixEvent};
use solana_program::instruction::Instruction;
use tokio::sync::mpsc::Sender;

#[derive(Clone, Debug)]
pub enum SDKMarketEvent {
    PhoenixEvent { event: Box<PhoenixEvent> },
    FairPriceUpdate { price: f64 },
    RefreshEvent,
}

#[async_trait]
pub trait MarketEventHandler<T: Send + Sync> {
    /// Called when a transaction with multiple events is processed
    /// Clients should override this method to build specific logic for handling
    /// new transactions
    async fn handle_events(&mut self, sender: &T, events: Vec<PhoenixEvent>) -> anyhow::Result<()> {
        for event in events.iter() {
            match event.details {
                MarketEventDetails::Fill(..) => {
                    self.handle_trade(sender, event).await?;
                }
                MarketEventDetails::Evict(..)
                | MarketEventDetails::Place(..)
                | MarketEventDetails::Reduce(..) => {
                    self.handle_orderbook_update(sender, event).await?;
                }
                MarketEventDetails::FillSummary(..) => {
                    self.handle_fill_summary(sender, event).await?;
                }
                MarketEventDetails::Fee(..) => {
                    // Ignore fee events
                }
            }
        }
        Ok(())
    }

    async fn handle_trade(&mut self, sender: &T, update: &PhoenixEvent) -> anyhow::Result<()>;

    async fn handle_fill_summary(
        &mut self,
        sender: &T,
        update: &PhoenixEvent,
    ) -> anyhow::Result<()>;

    async fn handle_orderbook_update(
        &mut self,
        sender: &T,
        update: &PhoenixEvent,
    ) -> anyhow::Result<()>;
}

pub struct LogHandler;
unsafe impl Send for LogHandler {}

#[async_trait]
impl MarketEventHandler<Sender<Vec<Instruction>>> for LogHandler {
    async fn handle_trade(
        &mut self,
        _sender: &Sender<Vec<Instruction>>,
        update: &PhoenixEvent,
    ) -> anyhow::Result<()> {
        println!("Trade: {:?}", update);
        Ok(())
    }

    async fn handle_orderbook_update(
        &mut self,
        _sender: &Sender<Vec<Instruction>>,
        update: &PhoenixEvent,
    ) -> anyhow::Result<()> {
        println!("Orderbook Update: {:?}", update);
        Ok(())
    }

    async fn handle_fill_summary(
        &mut self,
        _sender: &Sender<Vec<Instruction>>,
        update: &PhoenixEvent,
    ) -> anyhow::Result<()> {
        println!("Fill Summary: {:?}", update);
        Ok(())
    }
}
