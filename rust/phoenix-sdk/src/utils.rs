use ellipsis_client::EllipsisClient;
use phoenix::program::get_seat_address;
use phoenix_seat_manager::instruction_builders::create_claim_seat_instruction;
use solana_program::{instruction::Instruction, pubkey::Pubkey};
use spl_associated_token_account::{
    get_associated_token_address, instruction::create_associated_token_account,
};

pub async fn create_ata_ix_if_needed(
    client: &EllipsisClient,
    payer: &Pubkey,
    trader: &Pubkey,
    mint: &Pubkey,
) -> Option<Instruction> {
    let ata_address = get_associated_token_address(trader, mint);
    let ata_account = client.get_account(&ata_address).await;

    if let Ok(ata_account) = ata_account {
        if ata_account.data.is_empty() {
            return Some(create_associated_token_account(
                payer,
                trader,
                mint,
                &spl_token::ID,
            ));
        }
    }

    None
}

pub async fn create_claim_seat_ix_if_needed(
    client: &EllipsisClient,
    market: &Pubkey,
    trader: &Pubkey,
) -> Option<Instruction> {
    let seat_address = get_seat_address(market, trader).0;
    let seat_account = client.get_account(&seat_address).await;

    if let Ok(seat_account) = seat_account {
        if seat_account.data.is_empty() {
            return Some(create_claim_seat_instruction(trader, market));
        }
    }

    None
}
