use anyhow::anyhow;
use borsh::BorshDeserialize;
use clap::Parser;
use ellipsis_client::EllipsisClient;
use phoenix_sdk::event_poller::EventPoller;
use phoenix_sdk::market_event_handler::SDKMarketEvent;
use phoenix_sdk::sdk_client::get_decimal_string;
use phoenix_sdk::sdk_client::Fill;
use phoenix_sdk::sdk_client::MarketEventDetails;
use phoenix_sdk::sdk_client::SDKClient;
use phoenix_types::dispatch::load_with_dispatch;
use phoenix_types::dispatch::load_with_dispatch_mut;
use phoenix_types::enums::Side;
use phoenix_types::market::MarketHeader;
use solana_account_decoder::UiAccountEncoding;
use solana_client::rpc_client::RpcClient;
use solana_client::rpc_config::RpcAccountInfoConfig;
use solana_client::rpc_config::RpcProgramAccountsConfig;
use solana_client::rpc_filter::Memcmp;
use solana_client::rpc_filter::MemcmpEncodedBytes;
use solana_client::rpc_filter::RpcFilterType;
use solana_program::keccak;
use solana_program::pubkey::Pubkey;
use solana_sdk::commitment_config::CommitmentConfig;
use solana_sdk::signature::read_keypair_file;
use solana_sdk::signature::Keypair;
use solana_sdk::signer::Signer;
use std::env;
use std::mem::size_of;
use std::sync::Arc;
use tokio::join;
use tokio::sync::mpsc::channel;
use tokio::sync::mpsc::Receiver;

#[derive(clap::Parser, Debug)]
#[clap(author, version, about, long_about = None)]
struct Args {
    #[clap(short, long)]
    pub rpc: String,
}

fn get_discriminant(type_name: &str) -> u64 {
    u64::from_le_bytes(
        keccak::hashv(&[phoenix_types::ID.as_ref(), type_name.as_bytes()]).as_ref()[..8]
            .try_into()
            .unwrap(),
    )
}

fn get_payer_keypair() -> solana_sdk::signer::keypair::Keypair {
    match env::var("PAYER").is_ok() {
        true => Keypair::from_base58_string(&env::var("PAYER").expect("$PAYER is not set")[..]),
        false => read_keypair_file(&*shellexpand::tilde("~/.config/solana/id.json"))
            .map_err(|e| anyhow!(e.to_string()))
            .unwrap(),
    }
}

/// Sample code for getting market data from the blockchain
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    println!("Starting");

    let args = Args::parse();
    let payer = get_payer_keypair();
    let url = &args.rpc;

    println!("Payer: {}", payer.pubkey());
    println!("RPC endpoint: {}", url);
    println!();

    let client = EllipsisClient::from_rpc(
        RpcClient::new_with_commitment(url, CommitmentConfig::confirmed()),
        &payer,
    )?;

    let market_discriminant = get_discriminant("phoenix::program::accounts::MarketHeader");

    // Fetch all markets
    // Memcmp encoding field is deprecated
    #[allow(deprecated)]
    let program_accounts = client.get_program_accounts_with_config(
        &phoenix_types::ID,
        RpcProgramAccountsConfig {
            filters: Some(vec![RpcFilterType::Memcmp(Memcmp {
                offset: 0,
                bytes: MemcmpEncodedBytes::Bytes(market_discriminant.to_le_bytes().to_vec()),
                encoding: None,
            })]),
            // filters: None,
            account_config: RpcAccountInfoConfig {
                encoding: Some(UiAccountEncoding::Base64),
                commitment: Some(CommitmentConfig::confirmed()),
                ..RpcAccountInfoConfig::default()
            },

            ..RpcProgramAccountsConfig::default()
        },
    )?;

    println!("Found {} markets", program_accounts.len());
    let mut found_sol_usdc = false;

    // Deserialize the markets
    program_accounts
        .iter()
        .for_each(|(market_pubkey, account)| {
            let mut account_cloned = account.clone();
            // MarketHeader is fixed size; split the market account bytes into header bytes and market bytes
            let (header_bytes, _market_bytes) =
                account_cloned.data.split_at_mut(size_of::<MarketHeader>());

            // deserialize the header
            let header = MarketHeader::try_from_slice(header_bytes).unwrap();

            println!(
                "Pubkey: {:?}, Quote: {:?}, Base: {:?}",
                market_pubkey, header.quote_params.mint_key, header.base_params.mint_key
            );

            if header.base_params.mint_key == devnet_token_faucet::get_mint_address("SOL")
                && header.quote_params.mint_key == devnet_token_faucet::get_mint_address("USDC")
            {
                found_sol_usdc = true;
            }
        });

    if !found_sol_usdc {
        println!("No SOL-USDC market found");
        return Ok(());
    }

    // Get the SOL/USDC market.
    let (sol_usdc_market_pubkey, sol_usdc_market_account) = program_accounts
        .iter()
        .find(|(_market_pubkey, account)| {
            let mut account_cloned = account.clone();
            // MarketHeader is fixed size; split the market account bytes into header bytes and market bytes
            let (header_bytes, _market_bytes) =
                account_cloned.data.split_at_mut(size_of::<MarketHeader>());

            // deserialize the header
            let header = MarketHeader::try_from_slice(header_bytes).unwrap();

            header.base_params.mint_key == devnet_token_faucet::get_mint_address("SOL")
                && header.quote_params.mint_key == devnet_token_faucet::get_mint_address("USDC")
        })
        .unwrap();

    println!("Found SOL/USDC market: {:?}", sol_usdc_market_pubkey);

    let mut account_cloned = sol_usdc_market_account.clone();
    // MarketHeader is fixed size; split the market account bytes into header bytes and market bytes
    let (header_bytes, market_bytes) = account_cloned.data.split_at_mut(size_of::<MarketHeader>());

    // deserialize the header
    let header = MarketHeader::try_from_slice(header_bytes).unwrap();
    let market_size_params = header.market_size_params;

    // use params from the header to deserialize the market
    let market = load_with_dispatch_mut(&market_size_params, market_bytes)
        .unwrap()
        .inner;

    let sdk_client =
        Arc::new(SDKClient::new_from_ellipsis_client(sol_usdc_market_pubkey, client).await);
    let orderbook = sdk_client.get_market_orderbook().await;
    orderbook.print_ladder(5, 4);
    println!();

    // Get current position and open orders for the default devnet maker.
    let trader_pubkey = Pubkey::try_from("mkrc4jMLEPRoKLUnNL7Ctnwb7uJykbwiYvFjB4sw9Z9")?;
    println!("Getting open orders for default maker {:?}", trader_pubkey);
    print_open_orders(sol_usdc_market_pubkey, &trader_pubkey, &sdk_client).await?;
    println!(
        "Current token holdings for default maker {:?}",
        trader_pubkey
    );
    market
        .get_registered_traders()
        .iter()
        .filter(|(&pubkey, _state)| pubkey == trader_pubkey)
        .for_each(|(_pubkey, state)| {
            println!(
                "Base token locked: {}",
                get_decimal_string(
                    sdk_client.base_lots_to_base_atoms(state.base_lots_locked),
                    sdk_client.base_decimals
                )
            );
            println!(
                "Base token free: {}",
                get_decimal_string(
                    sdk_client.base_lots_to_base_atoms(state.base_lots_free),
                    sdk_client.base_decimals
                )
            );
            println!(
                "Quote token locked: {}",
                get_decimal_string(
                    sdk_client.quote_lots_to_quote_atoms(state.quote_lots_locked),
                    sdk_client.quote_decimals
                )
            );
            println!(
                "Quote token free: {}",
                get_decimal_string(
                    sdk_client.quote_lots_to_quote_atoms(state.quote_lots_free),
                    sdk_client.quote_decimals
                )
            );
        });

    println!();
    println!("Streaming all trades");
    let (market_event_sender, market_event_receiver) = channel(100);
    let event_poller =
        EventPoller::new_with_default_timeout(sdk_client.clone(), market_event_sender);
    let mut trade_writer = TradeWriter::new(sdk_client.clone(), market_event_receiver);

    join!(event_poller.run(), trade_writer.run());

    Ok(())
}

struct TradeWriter {
    sdk: Arc<SDKClient>,
    receiver: Receiver<Vec<SDKMarketEvent>>,
}

impl TradeWriter {
    pub fn new(sdk: Arc<SDKClient>, receiver: Receiver<Vec<SDKMarketEvent>>) -> Self {
        Self { sdk, receiver }
    }

    pub async fn run(&mut self) {
        loop {
            let market_events = match self.receiver.recv().await {
                Some(events) => events,
                None => {
                    println!("Error while receiving events");
                    continue;
                }
            };

            for market_event in market_events {
                match market_event {
                    SDKMarketEvent::PhoenixEvent { event } => match event.details {
                        MarketEventDetails::Fill(fill) => {
                            if event.market != self.sdk.active_market_key {
                                continue;
                            }

                            let Fill {
                                order_sequence_number,
                                maker,
                                taker,
                                price_in_ticks,
                                base_lots_filled,
                                side_filled,
                                ..
                            } = fill;

                            println!("Trade occurred");

                            let fill_data = vec![
                                ("Maker", maker.to_string()),
                                ("Taker", taker.to_string()),
                                ("Slot", event.slot.to_string()),
                                ("Order sequence number", order_sequence_number.to_string()),
                                ("Price in ticks", price_in_ticks.to_string()),
                                (
                                    "Price",
                                    (self.sdk.ticks_to_float_price(price_in_ticks)).to_string(),
                                ),
                                ("Side", format!("{:?}", side_filled)),
                                ("Base lots filled", base_lots_filled.to_string()),
                                (
                                    "Base units filled",
                                    get_decimal_string(
                                        self.sdk.base_lots_to_base_atoms(base_lots_filled),
                                        self.sdk.base_decimals,
                                    ),
                                ),
                            ];
                            fill_data
                                .iter()
                                .for_each(|(key, value)| println!("    {}: {}", key, value));
                        }
                        _ => continue,
                    },
                    _ => continue,
                }
            }
        }
    }
}

async fn print_open_orders(
    market_pubkey: &Pubkey,
    trader_pubkey: &Pubkey,
    sdk: &SDKClient,
) -> anyhow::Result<()> {
    // Get market account
    let mut market_account_data = sdk.client.get_account_data(market_pubkey).await?;
    let (header_bytes, market_bytes) = market_account_data.split_at_mut(size_of::<MarketHeader>());
    let header = MarketHeader::try_from_slice(header_bytes)?;

    // Derserialize data and load into correct type
    let market = load_with_dispatch(&header.market_size_params, market_bytes)
        .ok_or_else(|| anyhow::anyhow!("Failed to load market"))?
        .inner;

    let trader_index = market
        .get_trader_index(trader_pubkey)
        .ok_or_else(|| anyhow::anyhow!("Trader not found"))?;

    let book_bids = market.get_book(Side::Bid);
    let book_asks = market.get_book(Side::Ask);
    let price_precision: usize = 4;
    let size_precision: usize = 4;

    println!("Open Asks");
    let mut open_asks = vec![];
    open_asks.push(format!(
        "{0: <20} | {1: <20} | {2: <10} | {3: <10}",
        "ID", "Price (ticks)", "Price", "Quantity",
    ));
    for (order_id, order) in book_asks.iter() {
        if order.trader_index as u32 == trader_index {
            open_asks.push(format!(
                "{0: <20} | {1: <20} | {2: <10} | {3: <10}",
                order_id.order_sequence_number,
                order_id.price_in_ticks,
                format!(
                    "{:.1$}",
                    sdk.ticks_to_float_price(order_id.price_in_ticks),
                    price_precision
                ),
                format!(
                    "{:.1$}",
                    order.num_base_lots as f64 * sdk.base_lots_to_base_units_multiplier(),
                    size_precision,
                ),
            ));
        }
    }
    open_asks.iter().for_each(|line| println!("{}", line));
    println!("Open Bids");
    let mut open_bids = vec![];
    open_bids.push(format!(
        "{0: <20} | {1: <20} | {2: <10} | {3: <10}",
        "ID", "Price (ticks)", "Price", "Quantity"
    ));
    for (order_id, order) in book_bids.iter() {
        if order.trader_index as u32 == trader_index {
            open_bids.push(format!(
                "{0: <20} | {1: <20} | {2: <10} | {3: <10}",
                order_id.order_sequence_number,
                order_id.price_in_ticks,
                format!(
                    "{:.1$}",
                    sdk.ticks_to_float_price(order_id.price_in_ticks),
                    price_precision
                ),
                format!(
                    "{:.1$}",
                    order.num_base_lots as f64 * sdk.base_lots_to_base_units_multiplier(),
                    size_precision
                ),
            ));
        }
    }
    open_bids.iter().for_each(|line| println!("{}", line));

    Ok(())
}
