use crate::sdk_client::SDKClient;
use solana_program::instruction::Instruction;
use std::sync::Arc;
use tokio::sync::mpsc::Receiver;
use tokio::task::{spawn, JoinHandle};

pub struct TransactionExecutor {
    pub worker: JoinHandle<()>,
}

impl TransactionExecutor {
    pub fn new(client: Arc<SDKClient>, receiver: Receiver<Vec<Instruction>>) -> Self {
        let worker = spawn(async move {
            Self::run(client, receiver).await;
        });

        Self { worker }
    }

    pub async fn run(sdk: Arc<SDKClient>, mut receiver: Receiver<Vec<Instruction>>) {
        loop {
            let instructions = match receiver.recv().await {
                Some(instructions) => instructions,
                None => {
                    continue;
                }
            };
            let signature = sdk
                .client
                .sign_send_instructions(instructions, vec![])
                .await;
            match signature {
                Ok(s) => {
                    let logs = sdk.client.get_transaction(&s).await;
                    println!("Transaction sent: {}", s);
                    println!("Fills: {:?}", sdk.parse_fills(&s).await);

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
