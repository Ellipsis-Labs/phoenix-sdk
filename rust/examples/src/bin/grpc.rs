use clap::Parser;
use ellipsis_client::grpc_client::transaction_subscribe;
use phoenix_sdk::sdk_client::SDKClient;
use solana_sdk::{pubkey::Pubkey, signature::Keypair};
use tokio::{sync::mpsc::channel, try_join};

#[derive(Debug, Parser)]
#[clap(author, version, about)]
struct Args {
    #[clap(short, long)]
    /// gRPC service endpoint
    url: String,

    #[clap(long)]
    x_token: Option<String>,

    /// Filter included accounts in transactions
    #[clap(long, value_delimiter = ' ')]
    accounts_to_include: Vec<Pubkey>,

    /// Filter excluded accounts in transactions
    #[clap(long, value_delimiter = ' ')]
    accounts_to_exclude: Vec<Pubkey>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = Args::parse();
    let url = args.url.trim_end_matches('/').to_string();
    let sdk_url = url.clone();

    let (sender, mut receiver) = channel(10000);

    let x_token = match args.x_token {
        Some(t) => t,
        None => {
            // Split url by forward slash
            let mut url_split: Vec<&str> = url.split('/').collect();
            let token = url_split.pop().unwrap();
            token.to_string()
        }
    };

    let payer = Keypair::new();
    let phoenix_sdk = SDKClient::new(&payer, &sdk_url).await?;

    let market_data_sender = tokio::spawn(async move {
        transaction_subscribe(
            url.clone(),
            Some(x_token),
            sender,
            args.accounts_to_include,
            args.accounts_to_exclude,
        )
        .await
    });

    let handler = tokio::spawn(async move {
        while let Some(transaction) = receiver.recv().await {
            let events = phoenix_sdk.core.parse_events_from_transaction(&transaction);
            if let Some(events) = events {
                if let Some(parsed_events) = phoenix_sdk.parse_raw_phoenix_events(events).await {
                    for event in parsed_events {
                        println!("{:#?}", event);
                    }
                }
            }
        }
    });

    match try_join!(market_data_sender, handler) {
        Ok(_) => {}
        Err(_) => {
            println!("Error");
        }
    }

    Ok(())
}
