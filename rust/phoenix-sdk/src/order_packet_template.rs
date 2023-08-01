use phoenix::state::{SelfTradeBehavior, Side};

/// LimitOrderTemplate is a helper type for creating a limit order.
/// The template allows you to specify the price and size in commonly understood units:
/// price is the floating point price (units of USDC per unit of SOL for the SOL/USDC market), and size is in whole base units (units of SOL for the SOL/USDC market).
/// The SDK can then convert this to a limit order instruction, ready to be sent.
pub struct LimitOrderTemplate {
    // The side for the order, a Side::Bid or a Side::Ask.
    pub side: Side,

    /// The price of the order, as the commonly understood exchange price (the number of quote units to exchange for one base unit), as a floating point number.
    pub price_as_float: f64,

    /// Total number of base units, as a floating point number, to place on the book or fill at a better price.
    pub size_in_base_units: f64,

    /// How the matching engine should handle a self trade.
    pub self_trade_behavior: SelfTradeBehavior,

    /// Number of orders to match against. If this is `None` there is no limit.
    pub match_limit: Option<u64>,

    /// Client order id used to identify the order in the response to the client.
    pub client_order_id: u128,

    /// Flag for whether or not the order should only use funds that are already in the account.
    /// Using only deposited funds will allow the trader to pass in fewer accounts per instruction and
    /// save transaction space as well as compute.
    pub use_only_deposited_funds: bool,

    /// If this is set, the order will be invalid after the specified slot.
    pub last_valid_slot: Option<u64>,

    /// If this is set, the order will be invalid after the specified unix timestamp.
    pub last_valid_unix_timestamp_in_seconds: Option<u64>,

    /// Flag for whether or not to have the entire transaction fail if there are insufficient funds to place the order.
    /// When set to true and there are insufficient funds, the order will not be placed but the transaction will not immediately fail.
    pub fail_silently_on_insufficient_funds: bool,
}

/// PostOnlyOrderTemplate is a helper type for creating a post-only order, which will never be matched against existing orders.
/// The template allows you to specify the price and size in commonly understood units:
/// price is the floating point price (units of USDC per unit of SOL for the SOL/USDC market), and size is in whole base units (units of SOL for the SOL/USDC market).
/// The SDK can then convert this to a post-only order instruction, ready to be sent.
pub struct PostOnlyOrderTemplate {
    // The side for the order, a Side::Bid or a Side::Ask.
    pub side: Side,

    /// The price of the order, as the commonly understood exchange price (the number of quote units to exchange for one base unit), as a floating point number.
    pub price_as_float: f64,

    /// Total number of base units, as a floating point number, to place on the book or fill at a better price.
    pub size_in_base_units: f64,

    /// Client order id used to identify the order in the response to the client.
    pub client_order_id: u128,

    /// Flag for whether or not to reject the order if it would immediately match or amend it to the best non-crossing price.
    /// Default value is true.
    pub reject_post_only: bool,

    /// Flag for whether or not the order should only use funds that are already in the account.
    /// Using only deposited funds will allow the trader to pass in fewer accounts per instruction and
    /// save transaction space as well as compute.
    pub use_only_deposited_funds: bool,

    /// If this is set, the order will be invalid after the specified slot.
    pub last_valid_slot: Option<u64>,

    /// If this is set, the order will be invalid after the specified unix timestamp.
    pub last_valid_unix_timestamp_in_seconds: Option<u64>,

    /// Flag for whether or not to have the entire transaction fail if there are insufficient funds to place the order.
    /// When set to true and there are insufficient funds, the order will not be placed but the transaction will not immediately fail.
    pub fail_silently_on_insufficient_funds: bool,
}

/// ImmediateOrCancelOrderTemplate is a helper type for creating an immediate or cancel order.
/// The template allows you to specify the price and size in commonly understood units:
/// price is the floating point price (units of USDC per unit of SOL for the SOL/USDC market), and size is in whole base units (units of SOL for the SOL/USDC market).
/// The SDK can then convert this to a limit order instruction, ready to be sent.
///
/// Immediate-or-cancel orders will be matched against existing resting orders.
/// If the order matches fewer than `min_lots` lots, it will be cancelled.
///
/// Fill or Kill (FOK) orders are a subset of Immediate or Cancel (IOC) orders where either
/// the `num_base_lots` is equal to the `min_base_lots_to_fill` of the order, or the `num_quote_lots` is
/// equal to the `min_quote_lots_to_fill` of the order.
pub struct ImmediateOrCancelOrderTemplate {
    // The side for the order, a Side::Bid or a Side::Ask.
    pub side: Side,

    /// The most aggressive price an order can be matched at. If this value is None, then the order
    /// is treated as a market order.
    pub price_as_float: Option<f64>,

    /// The number of base units to fill against the order book. Either this parameter or the `num_quote_units`
    /// parameter must be set to a nonzero value.
    pub size_in_base_units: f64,

    /// The number of quote units to fill against the order book. Either this parameter or the `num_base_units`
    /// parameter must be set to a nonzero value.
    pub size_in_quote_units: f64,

    /// The minimum number of base units to fill against the order book. If the order does not fill
    /// this many base lots, it will be voided.
    pub min_base_units_to_fill: f64,

    /// The minimum number of quote units to fill against the order book. If the order does not fill
    /// this many quote lots, it will be voided.
    pub min_quote_units_to_fill: f64,

    /// How the matching engine should handle a self trade.
    pub self_trade_behavior: SelfTradeBehavior,

    /// Number of orders to match against. If set to `None`, there is no limit.
    pub match_limit: Option<u64>,

    /// Client order id used to identify the order in the response to the client.
    pub client_order_id: u128,

    /// Flag for whether or not the order should only use funds that are already in the account.
    /// Using only deposited funds will allow the trader to pass in less accounts per instruction and
    /// save transaction space as well as compute. This is only for traders who have a seat.
    pub use_only_deposited_funds: bool,

    /// If this is set, the order will be invalid after the specified slot.
    pub last_valid_slot: Option<u64>,

    /// If this is set, the order will be invalid after the specified unix timestamp.
    pub last_valid_unix_timestamp_in_seconds: Option<u64>,
}
