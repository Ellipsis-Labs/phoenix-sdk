use phoenix::state::enums::Side;
use solana_program::pubkey::Pubkey;
use solana_sdk::signature::Signature;

#[derive(Clone, Copy, Debug)]
pub struct Fill {
    /// The sequence number of the order that was filled.
    pub order_sequence_number: u64,
    /// The pubkey of the maker.
    pub maker: Pubkey,
    /// The pubkey of the taker.
    pub taker: Pubkey,
    /// The quote ticks per base unit of the order.
    pub price_in_ticks: u64,
    /// The number of lots that were filled in the order.
    pub base_lots_filled: u64,
    /// The number of lots that remain in the order.
    pub base_lots_remaining: u64,
    /// The side of the order that was filled.
    pub side_filled: Side,
    /// Whether the order was fully filled.
    pub is_full_fill: bool,
}

#[derive(Clone, Copy, Debug)]
pub struct PhoenixEvent {
    /// The pubkey of the market the trade occurred in
    pub market: Pubkey,
    /// The sequence number of the trade event.
    pub sequence_number: u64,
    /// The slot of the trade event.
    pub slot: u64,
    /// The timestamp of the trade event.
    pub timestamp: i64,
    /// The signature of the transaction that contains this event.
    pub signature: Signature,
    /// The signer of the transaction that contains this event.
    pub signer: Pubkey,
    /// The index of the trade in the list of trade_events.
    pub event_index: u64,
    /// Details of the event that are specific to the event type.
    pub details: MarketEventDetails,
}

#[derive(Clone, Copy, Debug)]
pub struct Reduce {
    /// The sequence number of the order that was reduced.
    pub order_sequence_number: u64,
    /// The pubkey of the maker.
    pub maker: Pubkey,
    /// The quote ticks per base unit of the order.
    pub price_in_ticks: u64,
    /// The number of lots that remain in the order.
    pub base_lots_removed: u64,
    /// The number of lots that remain in the order.
    pub base_lots_remaining: u64,
    /// Whether the order was fully canceled.
    pub is_full_cancel: bool,
}

#[derive(Clone, Copy, Debug)]
pub struct Evict {
    /// The sequence number of the order that was evicted.
    pub order_sequence_number: u64,
    /// The pubkey of the maker whose order was evicted.
    pub maker: Pubkey,
    /// The price of the order, in quote ticks per base unit
    pub price_in_ticks: u64,
    /// The number of lots that were forcibly removed from the book.
    pub base_lots_evicted: u64,
}

#[derive(Clone, Copy, Debug)]
pub struct Place {
    /// The sequence number of the order that was placed.
    pub order_sequence_number: u64,
    /// The client_order_id of the order that was placed.
    pub client_order_id: u128,
    /// The pubkey of the maker.
    pub maker: Pubkey,
    /// The quote ticks per base unit of the order.
    pub price_in_ticks: u64,
    /// The number of lots that were placed in the order.
    pub base_lots_placed: u64,
}

#[derive(Clone, Copy, Debug)]
pub struct FillSummary {
    /// The client_order_id of the order that was filled.
    pub client_order_id: u128,
    /// The total base quantity that was filled.
    pub total_base_filled: u64,
    /// The total quote quantity that was filled including fees.
    pub total_quote_filled_including_fees: u64,
    /// The total quote quantity fees that were paid.
    pub total_quote_fees: u64,
    /// Direction of the trade, 1 if buy side, -1 if sell side, 0 if the trade failed to match
    pub trade_direction: i8,
}

#[derive(Clone, Copy, Debug)]
pub struct TimeInForce {
    pub order_sequence_number: u64,
    pub last_valid_slot: u64,
    pub last_valid_unix_timestamp_in_seconds: u64,
}

#[derive(Clone, Copy, Debug)]
pub enum MarketEventDetails {
    Fill(Fill),
    Place(Place),
    Evict(Evict),
    Reduce(Reduce),
    FillSummary(FillSummary),
    Fee(u64),
    TimeInForce(TimeInForce),
}
