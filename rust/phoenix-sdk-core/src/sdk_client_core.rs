use solana_program::pubkey::Pubkey;

#[derive(Clone, Copy, Debug)]
pub struct PhoenixOrder {
    pub num_base_lots: u64,
    pub maker_id: Pubkey,
}
