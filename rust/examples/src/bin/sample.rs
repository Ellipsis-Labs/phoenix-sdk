use anyhow::anyhow;
use borsh::BorshDeserialize;
use clap::Parser;
use ellipsis_client::EllipsisClient;
use phoenix_sdk::sdk_client::SDKClient;
use phoenix_types::dispatch::load_with_dispatch_mut;
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
use std::env;
use std::mem::size_of;

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

    println!("RPC endpoint: {}", url);

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
            account_config: RpcAccountInfoConfig {
                encoding: Some(UiAccountEncoding::Base64),
                commitment: Some(CommitmentConfig::confirmed()),
                ..RpcAccountInfoConfig::default()
            },

            ..RpcProgramAccountsConfig::default()
        },
    )?;

    println!("Found {} markets", program_accounts.len());
    let mut sol_usdc_market: Option<Pubkey> = None;

    for (market_pubkey, account) in program_accounts {
        let mut account_cloned = account.clone();
        // MarketHeader is fixed size; split the market account bytes into header bytes and market bytes
        let (header_bytes, market_bytes) =
            account_cloned.data.split_at_mut(size_of::<MarketHeader>());

        // deserialize the header
        let header = MarketHeader::try_from_slice(header_bytes).unwrap();

        // use params from the header to deserialize the market
        let _market = load_with_dispatch_mut(&header.market_params, market_bytes)
            .unwrap()
            .inner;

        println!(
            "Pubkey: {:?}, Quote: {:?}, Base: {:?}",
            market_pubkey, header.quote_params.mint_key, header.base_params.mint_key
        );

        if header.base_params.mint_key.to_string() == "So11111111111111111111111111111111111111112"
        {
            sol_usdc_market = Some(market_pubkey);
        }
    }

    if sol_usdc_market.is_none() {
        println!("No SOL-USDC market found");
        return Ok(());
    }

    println!("Getting SOL/USDC order book");
    let sol_usdc_market = sol_usdc_market.unwrap();
    let sdk_client = SDKClient::new_from_ellipsis_client(&sol_usdc_market, client).await;
    let orderbook = sdk_client.get_market_orderbook().await;
    orderbook.print_ladder(5, 4);

    Ok(())
}
