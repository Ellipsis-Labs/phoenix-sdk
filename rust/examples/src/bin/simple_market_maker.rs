use anyhow::anyhow;
use borsh::BorshDeserialize;
use phoenix::{
    program::create_new_order_instruction,
    quantities::{BaseLots, Ticks, WrapperU64},
    state::{OrderPacket, Side},
};
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_program::{clock::Clock, sysvar};
use solana_sdk::signature::Signature;
use std::str::FromStr;

use clap::Parser;
use phoenix_sdk::sdk_client::{MarketMetadata, SDKClient};
use solana_cli_config::{Config, CONFIG_FILE};
#[allow(unused_imports)]
use solana_sdk::{
    instruction::Instruction,
    program_pack::Pack,
    pubkey::Pubkey,
    signature::{read_keypair_file, Keypair},
    signer::Signer,
};
pub mod utils;
use crate::utils::marinade::MarinadeState;

#[derive(Parser)]
struct Args {
    #[clap(short, long)]
    url: Option<String>,
    #[clap(short, long)]
    market: Pubkey,
    #[clap(short, long, default_value = "SOL-USD")]
    ticker: String,
    /// Optionally include your keypair path. Defaults to your Solana CLI config file.
    #[clap(short, long)]
    keypair_path: Option<String>,
    #[clap(long, default_value = "2000")]
    quote_refresh_frequency_in_ms: u64,
    #[clap(long, default_value = "5")]
    quote_edge_bps: u64,
    #[clap(long, default_value = "250.0")]
    quote_size_in_quote_units: f64,
    #[clap(long, default_value = "10")]
    order_lifetime_in_seconds: i64,
}

pub fn get_payer_keypair_from_path(path: &str) -> anyhow::Result<Keypair> {
    read_keypair_file(&*shellexpand::tilde(path)).map_err(|e| anyhow!(e.to_string()))
}

pub fn get_network(network_str: &str) -> &str {
    match network_str {
        "devnet" | "dev" | "d" => "https://api.devnet.solana.com",
        "mainnet" | "main" | "m" | "mainnet-beta" => "https://api.mainnet-beta.solana.com",
        "localnet" | "localhost" | "l" | "local" => "http://localhost:8899",
        _ => network_str,
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Connect to the solana network and get the market address
    let args = Args::parse();
    let config = match CONFIG_FILE.as_ref() {
        Some(config_file) => Config::load(config_file).unwrap_or_else(|_| {
            println!("Failed to load config file: {}", config_file);
            Config::default()
        }),
        None => Config::default(),
    };
    let trader = get_payer_keypair_from_path(&args.keypair_path.unwrap_or(config.keypair_path))?;
    let network_url = &get_network(&args.url.unwrap_or(config.json_rpc_url)).to_string();

    let mut sdk = SDKClient::new(&trader, network_url).await?;
    let market = args.market;
    sdk.add_market(&market).await?;

    let MarketMetadata {
        base_mint,
        quote_mint,
        ..
    } = sdk.get_market_metadata(&args.market);

    let mainnet_rpc = RpcClient::new("https://api.mainnet-beta.solana.com".to_string());

    loop {
        match market_make(
            &sdk,
            &args.market,
            &mainnet_rpc,
            &args.ticker.to_uppercase(),
            base_mint,
            quote_mint,
            args.quote_size_in_quote_units,
            args.quote_edge_bps,
            args.order_lifetime_in_seconds,
        )
        .await
        {
            Ok(sig) => println!("Txid: {}", sig),
            Err(e) => println!("Encountered error: {}", e),
        }

        tokio::time::sleep(std::time::Duration::from_millis(
            args.quote_refresh_frequency_in_ms,
        ))
        .await;
    }
}

async fn market_make(
    sdk: &SDKClient,
    market: &Pubkey,
    mainnet_rpc: &RpcClient,
    ticker: &str,
    base_mint: &Pubkey,
    quote_mint: &Pubkey,
    quote_size_in_quote_units: f64,
    quote_edge_bps: u64,
    order_lifetime_in_seconds: i64,
) -> anyhow::Result<Signature> {
    let cancel_all_ix = sdk.get_cancel_all_ix(market)?;
    let mut ixs = vec![cancel_all_ix];

    let fair_price = match ticker {
        ticker if ticker == "MSOL-SOL" => {
            let state_address = Pubkey::from_str("8szGkuLTAux9XMgZ2vtY39jVSowEcpBfFfD8hXSEqdGC")?;
            let marinade_state = mainnet_rpc.get_account_data(&state_address).await?;
            // Remove the first 8 bytes of the account data, which is the Anchor discriminant
            let state = MarinadeState::try_from_slice(&marinade_state[8..576])?;
            state.msol_price as f64 / (1_u64 << 32) as f64
        }
        _ => {
            let response = reqwest::get(format!(
                "https://api.coinbase.com/v2/prices/{}/spot",
                ticker
            ))
            .await?
            .json::<serde_json::Value>()
            .await?;

            f64::from_str(response["data"]["amount"].as_str().unwrap())?
        }
    };

    // place a bid and ask at the fair price +/- edge
    let bid_price = fair_price * (1.0 - quote_edge_bps as f64 / 10000.0);
    let ask_price = fair_price * (1.0 + quote_edge_bps as f64 / 10000.0);

    if bid_price == 0.0 || ask_price == 0.0 {
        println!("Bid or ask price is 0.0, skipping order placement, cancelling orders");
        let txid = sdk.client.sign_send_instructions(ixs, vec![]).await?;
        return Ok(txid);
    }

    let bid_size = quote_size_in_quote_units / bid_price;
    let ask_size = quote_size_in_quote_units / ask_price;

    let clock_account_data = sdk.client.get_account_data(&sysvar::clock::id()).await?;

    let clock: Clock = bincode::deserialize(&clock_account_data)
        .map_err(|_| anyhow::Error::msg("Error deserializing clock"))?;

    let bid_order_packet = OrderPacket::Limit {
        side: Side::Bid,
        price_in_ticks: sdk
            .float_price_to_ticks(&market, bid_price)
            .map(Ticks::new)?,
        num_base_lots: sdk
            .raw_base_units_to_base_lots(&market, bid_size)
            .map(BaseLots::new)?,
        self_trade_behavior: phoenix::state::SelfTradeBehavior::CancelProvide,
        match_limit: None,
        client_order_id: 0,
        use_only_deposited_funds: false,
        last_valid_slot: None,
        last_valid_unix_timestamp_in_seconds: Some(
            (clock.unix_timestamp + order_lifetime_in_seconds) as u64,
        ),
    };

    let ask_order_packet = OrderPacket::Limit {
        side: Side::Ask,
        price_in_ticks: sdk
            .float_price_to_ticks(&market, ask_price)
            .map(Ticks::new)?,
        num_base_lots: sdk
            .raw_base_units_to_base_lots(&market, ask_size)
            .map(BaseLots::new)?,
        self_trade_behavior: phoenix::state::SelfTradeBehavior::CancelProvide,
        match_limit: None,
        client_order_id: 0,
        use_only_deposited_funds: false,
        last_valid_slot: None,
        last_valid_unix_timestamp_in_seconds: Some(
            (clock.unix_timestamp + order_lifetime_in_seconds) as u64,
        ),
    };

    println!("{} {} @ {} {}", bid_size, bid_price, ask_price, ask_size);

    let bid_ix = create_new_order_instruction(
        &market,
        &sdk.get_trader(),
        base_mint,
        quote_mint,
        &bid_order_packet,
    );

    let ask_ix = create_new_order_instruction(
        &market,
        &sdk.get_trader(),
        base_mint,
        quote_mint,
        &ask_order_packet,
    );

    ixs.push(bid_ix);
    ixs.push(ask_ix);

    let txid = sdk.client.sign_send_instructions(ixs, vec![]).await?;
    Ok(txid)
}
