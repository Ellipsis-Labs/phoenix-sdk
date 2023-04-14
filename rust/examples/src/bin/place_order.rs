use std::str::FromStr;

use ellipsis_client::EllipsisClient;
use phoenix::state::Side;
use phoenix_sdk::sdk_client::SDKClient;
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::account::Account;
use solana_sdk::commitment_config::CommitmentConfig;
#[allow(unused_imports)]
use solana_sdk::{
    instruction::Instruction,
    program_pack::Pack,
    pubkey::Pubkey,
    signature::{read_keypair_file, Keypair},
    signer::Signer,
};
use spl_associated_token_account::instruction::create_associated_token_account;
use spl_token::state::Mint;
#[tokio::main]
async fn main() {
    // Connect to the Solana network and identify the market you want to interact with, using phoenix-cli, for example.
    let network_url = "https://api.devnet.solana.com";
    let market_pubkey = Pubkey::from_str("CS2H8nbAVVEUHWPF5extCSymqheQdkd4d7thik6eet9N").unwrap();

    let trader = Keypair::new();
    let rpc_client =
        RpcClient::new_with_commitment(network_url.to_string(), CommitmentConfig::confirmed());
    // Create an EllipsisClient with a payer, here the trader keypair.
    // Alternatively, read from keypair file for the payer
    // let path = "~/.config/solana/id.json";
    // let auth_payer = read_keypair_file(&*shellexpand::tilde(path)).unwrap();
    let client = EllipsisClient::from_rpc(rpc_client, &trader).unwrap();
    println!("Trader pubkey: {}", trader.pubkey());
    // Create an SDKClient instance using the recommended method. If you only needed a specific known market, you can also use SDKClient::new_with_market_keys
    let sdk = SDKClient::new_from_ellipsis_client_with_all_markets(client)
        .await
        .unwrap();

    println!("trader {}", sdk.trader);

    // This instruction only works on devnet. It requests an airdrop of devnet SOL to pay for transaction fees.
    sdk.client
        .request_airdrop(&trader.pubkey(), 1_000_000_000)
        .await
        .unwrap();
    // These instructions only work on devnet. They trigger an airdrop from the generic-token-faucet (https://github.com/Ellipsis-Labs/generic-token-faucet) for the base and quote tokens for the supplied market, used for testing trades.
    let instructions = create_airdrop_spl_ixs(&sdk, &market_pubkey, &trader.pubkey())
        .await
        .unwrap();
    sdk.client
        .sign_send_instructions(instructions, vec![])
        .await
        .unwrap();

    // Send limit order instruction bundle:
    // - Create the associated token account, if needed, for both base and quote tokens
    // - Claim a seat on the market, if needed
    // - Place the post only order
    let limit_order_new_maker_ixs = sdk
        .get_post_only_new_maker_ixs(
            &market_pubkey,
            sdk.float_price_to_ticks_rounded_down(&market_pubkey, 500.0)
                .unwrap(),
            Side::Bid,
            1_000,
        )
        .await
        .unwrap();
    println!("Ix Len: {}", limit_order_new_maker_ixs.len());
    let sig = sdk
        .client
        .sign_send_instructions(limit_order_new_maker_ixs, vec![])
        .await
        .unwrap();

    println!(
        "Link to view transaction: https://beta.solscan.io/tx/{}?cluster=devnet",
        sig
    );

    // After you have been setup as a maker on the market (handled above), you can place limit orders by sending the limit order instruction directly.
    // Note that if your seat has been evicted, you will need to claim a new seat before placing a new order.
    // Instructions for claiming a seat can be created with the create_claim_seat_ix_if_needed function.

    for i in 0..5 {
        let limit_order_ix = sdk
            .get_limit_order_ix(
                &market_pubkey,
                sdk.float_price_to_ticks_rounded_down(&market_pubkey, 500.0)
                    .unwrap(),
                Side::Bid,
                1_000,
            )
            .unwrap();

        let sig = sdk
            .client
            .sign_send_instructions(vec![limit_order_ix], vec![])
            .await
            .unwrap();

        println!(
            "Order {} tx link: https://beta.solscan.io/tx/{}?cluster=devnet",
            i + 1,
            sig
        );
    }
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
