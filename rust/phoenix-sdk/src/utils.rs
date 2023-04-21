use std::{collections::BTreeMap, mem::size_of};

use ellipsis_client::EllipsisClient;
use phoenix::program::{
    dispatch_market, get_seat_address, status::SeatApprovalStatus, MarketHeader, Seat,
};
use phoenix_seat_manager::{
    get_seat_manager_address,
    instruction_builders::{
        create_claim_seat_instruction, create_evict_seat_instruction, EvictTraderAccountBackup,
    },
    seat_manager::SeatManager,
};
use solana_program::{instruction::Instruction, pubkey::Pubkey};
use spl_associated_token_account::{
    get_associated_token_address, instruction::create_associated_token_account,
};

pub async fn create_ata_ix_if_needed(
    client: &EllipsisClient,
    payer: &Pubkey,
    trader: &Pubkey,
    mint: &Pubkey,
) -> Vec<Instruction> {
    let ata_address = get_associated_token_address(trader, mint);
    let ata_account = client.get_account(&ata_address).await;

    if let Ok(ata_account) = ata_account {
        if !ata_account.data.is_empty() {
            return vec![];
        }
    }
    vec![create_associated_token_account(
        payer,
        trader,
        mint,
        &spl_token::ID,
    )]
}

// Check if seat already exists, if not, create seat instruction.
// Check if the market trader state is full, if so, find a seat to evict and add the evict instruction.
pub async fn create_claim_seat_ix_if_needed(
    client: &EllipsisClient,
    market_pubkey: &Pubkey,
    trader: &Pubkey,
) -> anyhow::Result<Vec<Instruction>> {
    let seat_address = get_seat_address(market_pubkey, trader).0;
    let seat_account = client.get_account(&seat_address).await;

    // If the seat is found, is initialized, and is already Approved, return early.
    if let Ok(seat_account) = seat_account {
        if !seat_account.data.is_empty() {
            let seat_struct = bytemuck::from_bytes::<Seat>(seat_account.data.as_slice());
            // If the seat account is found and is already approved, return early.
            if SeatApprovalStatus::from(seat_struct.approval_status) == SeatApprovalStatus::Approved
            {
                return Ok(vec![]);
            }
        }
    }

    // If the seat is not found, or the seat data is empty, or the seat is not approved, check if eviction needs to be performed (if market trader state is full). Then create a claim seat instruction.
    let mut instructions = vec![];
    if let Ok(Some(evict_trader_ix)) = get_evictable_trader_ix(client, market_pubkey).await {
        instructions.push(evict_trader_ix);
    }
    instructions.push(create_claim_seat_instruction(trader, market_pubkey));

    Ok(instructions)
}

// Finds the first evictable trader without locked base or quote lots when the market state is full.
pub async fn get_evictable_trader_ix(
    client: &EllipsisClient,
    market_pubkey: &Pubkey,
) -> anyhow::Result<Option<Instruction>> {
    let market_bytes = client.get_account_data(market_pubkey).await?;
    let (header_bytes, market_bytes) = market_bytes.split_at(size_of::<MarketHeader>());
    let market_header = bytemuck::try_from_bytes::<MarketHeader>(header_bytes)
        .map_err(|e| anyhow::anyhow!("Error deserializing market header. Error: {:?}", e))?;

    let max_traders = market_header.market_size_params.num_seats;
    let num_traders =
        dispatch_market::load_with_dispatch(&market_header.market_size_params, market_bytes)?
            .inner
            .get_registered_traders()
            .len() as u64;

    // If the market's trader state is full, evict a trader to make room for a new trader.
    if num_traders == max_traders {
        let trader_tree =
            dispatch_market::load_with_dispatch(&market_header.market_size_params, market_bytes)?
                .inner
                .get_registered_traders()
                .iter()
                .map(|(k, v)| (*k, *v))
                .collect::<BTreeMap<_, _>>();

        let seat_manager_address = get_seat_manager_address(market_pubkey).0;
        let seat_manager_account = client.get_account_data(&seat_manager_address).await?;
        let seat_manager_struct = bytemuck::try_from_bytes::<SeatManager>(
            seat_manager_account.as_slice(),
        )
        .map_err(|e| anyhow::anyhow!("Error deserializing seat manager data. Error: {:?}", e))?;

        //Find a seat to evict (a trader with no locked base or quote lots) and evict trader.
        for (trader_pubkey, trader_state) in trader_tree.iter() {
            if trader_state.base_lots_locked == 0 && trader_state.quote_lots_locked == 0 {
                // A DMM cannot be evicted directly. They must first be removed as a DMM. Skip DMMs in this search.
                if seat_manager_struct.contains(trader_pubkey) {
                    continue;
                }
                let evict_trader_state = EvictTraderAccountBackup {
                    trader_pubkey: *trader_pubkey,
                    base_token_account_backup: None,
                    quote_token_account_backup: None,
                };
                return Ok(Some(create_evict_seat_instruction(
                    market_pubkey,
                    &market_header.base_params.mint_key,
                    &market_header.quote_params.mint_key,
                    trader_pubkey,
                    vec![evict_trader_state],
                )));
            }
        }
        return Err(anyhow::anyhow!(
            "Trader state is full but unable to find a trader with no locked lots to evict."
        ));
    };
    Ok(None)
}
