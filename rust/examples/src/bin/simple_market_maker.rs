use anyhow::anyhow;
use phoenix::state::Side;
use solana_program::{clock::Clock, sysvar};
use solana_sdk::{account::Account, signature::Signature};
use spl_token::state::Mint;
use std::str::FromStr;

use clap::Parser;
use phoenix_sdk::{order_packet_template::LimitOrderTemplate, sdk_client::SDKClient};
use solana_cli_config::{Config, CONFIG_FILE};
#[allow(unused_imports)]
use solana_sdk::{
    instruction::Instruction,
    program_pack::Pack,
    pubkey::Pubkey,
    signature::{read_keypair_file, Keypair},
    signer::Signer,
};
use spl_associated_token_account::instruction::create_associated_token_account;

// Command-line arguments to parameterize the market maker.
#[derive(Parser)]
struct Args {
    /// Optionally, use your own RPC endpoint by passing into the -u flag.
    #[clap(short, long)]
    url: Option<String>,

    #[clap(short, long)]
    market: Pubkey,

    // The ticker is used to pull the price from the Coinbase API, and therefore should conform to the Coinbase ticker format.
    /// Note that for all USDC quoted markets, the price feed should use "USD" instead of "USDC".
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

// This script runs a simple market maker, which provides limit order bids and asks, on a given phoenix market.
// To run this simple market maker example, use the following command from the examples directory: `cargo run --bin simple_market_maker -- -m CS2H8nbAVVEUHWPF5extCSymqheQdkd4d7thik6eet9N`
// To run this example with your own RPC endpoint, use the following command from the examples directory:
// `cargo run --bin simple_market_maker -- -m CS2H8nbAVVEUHWPF5extCSymqheQdkd4d7thik6eet9N -u $YOUR_DEVNET_RPC_ENDPOINT`
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Connect to the solana network and create a Phoenix Client with your trader keypair and the market pubkey.
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

    // To test on devnet, (i) airdrop devnet SOL to the trader account, and (ii) airdrop tokens for the market's base and quote tokens.
    // These instructions only work on devnet.
    // (i) airdrop devnet SOL to the trader account. This step may not be needed if your trader keypair (from the above file_path) already has devnet SOL.
    // Below is an example of how to airdrop devnet SOL to the trader account. Commented out here because this method fails frequently on devnet.
    // Ensure that your trader keypair has devnet SOL to execute transactions.
    // sdk.client
    //     .request_airdrop(&trader.pubkey(), 1_000_000_000)
    //     .await
    //     .unwrap();

    // (ii) Airdrop tokens for the base and quote tokens for the supplied market, used for testing trades.
    // Uses the generic-token-faucet (https://github.com/Ellipsis-Labs/generic-token-faucet).
    let instructions = create_airdrop_spl_ixs(&sdk, &market, &trader.pubkey())
        .await
        .unwrap();
    let setup_tx = sdk
        .client
        .sign_send_instructions(instructions, vec![])
        .await
        .unwrap();
    println!(
        "Setup tx: https://beta.solscan.io/tx/{}?cluster=devnet",
        setup_tx
    );

    // To place limit orders on Phoenix, you need to ensure that you have associated token accounts for the base and quote tokens, and that you have a seat on the market.
    // This method checks these requirements and returns instructions to create the necessary accounts, if needed:
    // - Creation of associated token accounts for base and quote tokens, if needed.
    // - Claiming of the market's seat, if needed.
    // - Evicting a seat on the market if the market trader state is full.
    // Once you have a seat, you can freely place orders without needing to claim a seat before every order.
    // Note: If the market's trader state is full and your seat is not in use (you do not have locked funds), your seat may be evicted, causing future limit orders to fail.
    // In that case, simply request a new seat with the SDK method `sdk.create_claim_seat_ix_if_needed`.
    let maker_setup_instructions = sdk.get_maker_setup_instructions_for_market(&market).await?;
    sdk.client
        .sign_send_instructions(maker_setup_instructions, vec![])
        .await
        .unwrap();

    loop {
        match cancel_and_place_quotes(
            &sdk,
            &args.market,
            &args.ticker.to_uppercase(),
            args.quote_size_in_quote_units,
            args.quote_edge_bps,
            args.order_lifetime_in_seconds,
        )
        .await
        {
            Ok(sig) => println!("Tx Link: https://beta.solscan.io/tx/{}?cluster=devnet", sig),
            Err(e) => println!("Encountered error: {}", e),
        }

        tokio::time::sleep(std::time::Duration::from_millis(
            args.quote_refresh_frequency_in_ms,
        ))
        .await;
    }
}

async fn cancel_and_place_quotes(
    sdk: &SDKClient,
    market: &Pubkey,
    ticker: &str,
    quote_size_in_quote_units: f64,
    quote_edge_bps: u64,
    order_lifetime_in_seconds: i64,
) -> anyhow::Result<Signature> {
    let cancel_all_ix = sdk.get_cancel_all_ix(market)?;
    let mut ixs = vec![cancel_all_ix];

    let fair_price = {
        let response = reqwest::get(format!(
            "https://api.coinbase.com/v2/prices/{}/spot",
            ticker
        ))
        .await?
        .json::<serde_json::Value>()
        .await?;

        f64::from_str(response["data"]["amount"].as_str().unwrap())?
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
    // Get the current chain time for to specify an order expiration time (time in force orders).
    let clock_account_data = sdk.client.get_account_data(&sysvar::clock::id()).await?;

    let clock: Clock = bincode::deserialize(&clock_account_data)
        .map_err(|_| anyhow::Error::msg("Error deserializing clock"))?;

    // Create a LimitOrderTemplate for the bid and ask orders.
    // the LimitOrderTemplate allows you to specify the price and size in commonly understood units:
    // price is the floating point price (units of USDC per unit of SOL for the SOL/USDC market), and size is in whole base units (units of SOL for the SOL/USDC market).
    let bid_limit_order_template = LimitOrderTemplate {
        side: Side::Bid,
        price_as_float: bid_price,
        size_in_base_units: bid_size,
        self_trade_behavior: phoenix::state::SelfTradeBehavior::CancelProvide,
        match_limit: None,
        client_order_id: 0,
        use_only_deposited_funds: false,
        last_valid_slot: None,
        last_valid_unix_timestamp_in_seconds: Some(
            (clock.unix_timestamp + order_lifetime_in_seconds) as u64,
        ),
        fail_silently_on_insufficient_funds: false,
    };

    let ask_limit_order_template = LimitOrderTemplate {
        side: Side::Ask,
        price_as_float: ask_price,
        size_in_base_units: ask_size,
        self_trade_behavior: phoenix::state::SelfTradeBehavior::CancelProvide,
        match_limit: None,
        client_order_id: 0,
        use_only_deposited_funds: false,
        last_valid_slot: None,
        last_valid_unix_timestamp_in_seconds: Some(
            (clock.unix_timestamp + order_lifetime_in_seconds) as u64,
        ),
        fail_silently_on_insufficient_funds: false,
    };

    println!("Placing bid for size {}, price {}", bid_size, bid_price);
    println!("Placing ask for size {}, price {}", ask_size, ask_price);

    let market_metadata = sdk.get_market_metadata(market).await?;
    // Use an SDK-provided helper function to convert the limit order template into a limit order instruction, which contains Phoenix-specific units that the orderbook uses.
    let bid_ix =
        sdk.get_limit_order_ix_from_template(market, &market_metadata, &bid_limit_order_template)?;

    let ask_ix =
        sdk.get_limit_order_ix_from_template(market, &market_metadata, &ask_limit_order_template)?;

    ixs.push(bid_ix);
    ixs.push(ask_ix);

    let txid = sdk.client.sign_send_instructions(ixs, vec![]).await?;
    Ok(txid)
}

// Only needed for devnet testing
pub async fn create_airdrop_spl_ixs(
    sdk_client: &SDKClient,
    market_pubkey: &Pubkey,
    recipient_pubkey: &Pubkey,
) -> Option<Vec<Instruction>> {
    // Get base and quote mints from market metadata
    let market_metadata = sdk_client.get_market_metadata(market_pubkey).await.ok()?;
    let base_mint = market_metadata.base_mint;
    let quote_mint = market_metadata.quote_mint;

    let mint_accounts = sdk_client
        .client
        .get_multiple_accounts(&[base_mint, quote_mint])
        .await
        .unwrap()
        .into_iter()
        .flatten()
        .collect::<Vec<Account>>();

    let base_mint_account = Mint::unpack(&mint_accounts[0].data).unwrap();

    let quote_mint_account = Mint::unpack(&mint_accounts[1].data).unwrap();

    let base_mint_authority = base_mint_account.mint_authority.unwrap();
    let quote_mint_authority = quote_mint_account.mint_authority.unwrap();

    let mint_authority_accounts = sdk_client
        .client
        .get_multiple_accounts(&[base_mint_authority, quote_mint_authority])
        .await
        .unwrap()
        .into_iter()
        .flatten()
        .collect::<Vec<Account>>();

    // If either the base or quote mint authority accounts (PDAs) are not owned by the devnet token faucet program, abort minting
    if mint_authority_accounts[0].owner != generic_token_faucet::id()
        || mint_authority_accounts[1].owner != generic_token_faucet::id()
    {
        return None;
    }

    // Get or create the ATA for the recipient. If doesn't exist, create token account
    let mut instructions = vec![];

    let recipient_ata_base =
        spl_associated_token_account::get_associated_token_address(recipient_pubkey, &base_mint);

    let recipient_ata_quote =
        spl_associated_token_account::get_associated_token_address(recipient_pubkey, &quote_mint);

    let recipient_ata_accounts = sdk_client
        .client
        .get_multiple_accounts(&[recipient_ata_base, recipient_ata_quote])
        .await
        .unwrap();

    if recipient_ata_accounts[0].is_none() {
        println!("Error retrieving base ATA. Creating base ATA");
        instructions.push(create_associated_token_account(
            &sdk_client.client.payer.pubkey(),
            recipient_pubkey,
            &base_mint,
            &spl_token::id(),
        ))
    };

    if recipient_ata_accounts[1].is_none() {
        println!("Error retrieving quote ATA. Creating quote ATA");
        instructions.push(create_associated_token_account(
            &sdk_client.client.payer.pubkey(),
            recipient_pubkey,
            &quote_mint,
            &spl_token::id(),
        ))
    };

    // Finally, mint the base and quote tokens to the recipient. The recipient's ATAs will be automatically derived.
    instructions.push(generic_token_faucet::airdrop_spl_with_mint_pdas_ix(
        &generic_token_faucet::id(),
        &base_mint,
        &base_mint_authority,
        recipient_pubkey,
        (5000.0 * 1e9) as u64,
    ));

    instructions.push(generic_token_faucet::airdrop_spl_with_mint_pdas_ix(
        &generic_token_faucet::id(),
        &quote_mint,
        &quote_mint_authority,
        recipient_pubkey,
        (500000.0 * 1e6) as u64,
    ));

    Some(instructions)
}
