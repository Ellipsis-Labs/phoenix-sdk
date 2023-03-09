use std::str::FromStr;

use phoenix::state::Side;
use phoenix_sdk::sdk_client::SDKClient;
use solana_sdk::{
    instruction::Instruction,
    program_pack::Pack,
    pubkey::Pubkey,
    signature::{read_keypair_file, Keypair},
    signer::Signer,
};
use spl_token::state::Mint;

#[tokio::main]
async fn main() {
    // Connect to the solana network and get the market address
    let network_url = "https://api.devnet.solana.com";
    let market = Pubkey::from_str("CS2H8nbAVVEUHWPF5extCSymqheQdkd4d7thik6eet9N").unwrap();

    let trader = Keypair::new();
    println!("Trader pubkey: {}", trader.pubkey());
    let sdk = SDKClient::new(&market, &trader, network_url).await;
    // Alternatively, read from keypair file for the payer
    // let path = "~/.config/solana/id.json";
    // let auth_payer = read_keypair_file(&*shellexpand::tilde(path)).unwrap();

    println!("trader {}", sdk.trader);

    // Only relevant for devnet
    let instructions = create_airdrop_spl_ixs(&sdk, &trader.pubkey())
        .await
        .unwrap();
    sdk.client
        .request_airdrop(&trader.pubkey(), 1_500_000_000)
        .await
        .unwrap();
    sdk.client
        .sign_send_instructions(instructions, vec![])
        .await
        .unwrap();

    // Send limit order instruction bundle
    let limit_order_new_maker_ixs = sdk
        .get_post_only_new_maker_ixs(sdk.float_price_to_ticks(500.0), Side::Bid, 1_000)
        .await;
    println!("Ix Len: {}", limit_order_new_maker_ixs.len());
    let sig = sdk
        .client
        .sign_send_instructions(limit_order_new_maker_ixs, vec![])
        .await
        .unwrap();

    println!("Tx Signature: {}", sig);
}

// Only needed for devnet testing
pub async fn create_airdrop_spl_ixs(
    sdk_client: &SDKClient,
    recipient_pubkey: &Pubkey,
) -> Option<Vec<Instruction>> {
    // Get base and quote mints from market metadata
    let market_metadata = sdk_client.get_active_market_metadata();
    let base_mint = market_metadata.base_mint;
    let quote_mint = market_metadata.quote_mint;

    let base_mint_account = Mint::unpack(
        &sdk_client
            .client
            .get_account_data(&base_mint)
            .await
            .unwrap(),
    )
    .unwrap();

    let quote_mint_account = Mint::unpack(
        &sdk_client
            .client
            .get_account_data(&quote_mint)
            .await
            .unwrap(),
    )
    .unwrap();

    let quote_mint_authority = quote_mint_account.mint_authority.unwrap();
    let base_mint_authority = base_mint_account.mint_authority.unwrap();

    if sdk_client
        .client
        .get_account(&quote_mint_authority)
        .await
        .unwrap()
        .owner
        != devnet_token_faucet::id()
    {
        return None;
    }

    if sdk_client
        .client
        .get_account(&base_mint_authority)
        .await
        .unwrap()
        .owner
        != devnet_token_faucet::id()
    {
        return None;
    }

    // Get or create the ATA for the recipient. If doesn't exist, create token account
    let mut instructions = vec![];

    let recipient_ata_base =
        spl_associated_token_account::get_associated_token_address(recipient_pubkey, &base_mint);

    if sdk_client
        .client
        .get_account(&recipient_ata_base)
        .await
        .is_err()
    {
        println!("Error retrieving ATA. Creating ATA");
        instructions.push(
            spl_associated_token_account::instruction::create_associated_token_account(
                &sdk_client.client.payer.pubkey(),
                recipient_pubkey,
                &base_mint,
                &spl_token::id(),
            ),
        )
    };

    let recipient_ata_quote =
        spl_associated_token_account::get_associated_token_address(recipient_pubkey, &quote_mint);

    if sdk_client
        .client
        .get_account(&recipient_ata_quote)
        .await
        .is_err()
    {
        println!("Error retrieving ATA. Creating ATA");
        instructions.push(
            spl_associated_token_account::instruction::create_associated_token_account(
                &sdk_client.client.payer.pubkey(),
                recipient_pubkey,
                &quote_mint,
                &spl_token::id(),
            ),
        )
    };

    instructions.push(devnet_token_faucet::airdrop_spl_with_mint_pdas_ix(
        &devnet_token_faucet::id(),
        &base_mint,
        &base_mint_authority,
        recipient_pubkey,
        (5000.0 * 1e9) as u64,
    ));

    instructions.push(devnet_token_faucet::airdrop_spl_with_mint_pdas_ix(
        &devnet_token_faucet::id(),
        &quote_mint,
        &quote_mint_authority,
        recipient_pubkey,
        (500000.0 * 1e6) as u64,
    ));

    Some(instructions)
}
