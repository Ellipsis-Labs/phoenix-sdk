use crate::sdk_client::SDKClient;
use solana_program::{instruction::Instruction, pubkey::Pubkey};
use std::sync::Arc;
use tokio::sync::mpsc::UnboundedReceiver;

pub struct TransactionExecutor {
    pub client: Arc<SDKClient>,
    pub market_key: Pubkey,
    pub ix_receiver: UnboundedReceiver<Vec<Instruction>>,
}

impl TransactionExecutor {
    pub fn new(client: Arc<SDKClient>, market_key: Pubkey, ix_receiver: UnboundedReceiver<Vec<Instruction>>) -> Self {
        Self {
            client,
            market_key,
            ix_receiver,
        }
    }

    pub async fn run(&mut self) -> anyhow::Result<()> {
        loop {
            let instructions = match self.ix_receiver.recv().await {
                Some(instructions) => instructions,
                None => {
                    continue;
                }
            };
            let signature = self
                .client
                .client
                .sign_send_instructions(instructions, vec![])
                .await;
            match signature {
                Ok(s) => {
                    let logs = self.client.client.get_transaction(&s).await;
                    println!("Transaction sent: {}", s);
                    println!("Fills: {:?}", self.client.parse_fills(&self.market_key, &s).await);

                    match logs {
                        Ok(logs) => {
                            println!("Logs: {:?}", logs.logs);
                        }
                        Err(e) => {
                            println!("Error getting logs: {:?}", e);
                        }
                    }
                }
                Err(e) => {
                    println!("Transaction failed: {}", e);
                }
            }
        }
    }
}
