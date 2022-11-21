use crate::sdk_client::SDKClient;
use solana_program::instruction::Instruction;
use std::{
    sync::{mpsc::Receiver, Arc},
    thread::{Builder, JoinHandle},
};

pub struct TransactionExecutor {
    pub worker: JoinHandle<()>,
}

impl TransactionExecutor {
    pub fn new(client: Arc<SDKClient>, receiver: Receiver<Vec<Instruction>>) -> Self {
        let worker = Builder::new()
            .name("transaction-executor".to_string())
            .spawn(move || Self::run(client.clone(), receiver))
            .unwrap();

        Self { worker }
    }

    pub fn join(self) {
        self.worker.join().unwrap()
    }

    pub fn run(sdk: Arc<SDKClient>, receiver: Receiver<Vec<Instruction>>) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        loop {
            let instructions = match receiver.recv() {
                Ok(instructions) => instructions,
                Err(_) => {
                    continue;
                }
            };
            let signature = rt.block_on(sdk.client.sign_send_instructions(instructions, vec![]));
            match signature {
                Ok(s) => {
                    let logs = rt.block_on(sdk.client.get_transaction(&s));
                    println!("Transaction sent: {}", s);
                    println!("Fills: {:?}", rt.block_on(sdk.parse_fills(&s)));

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
