use borsh::BorshDeserialize;
use ellipsis_client::EllipsisClient;
use phoenix_sdk_core::sdk_client_core::MarketState;
pub use phoenix_sdk_core::{
    market_event::{Evict, Fill, FillSummary, MarketEventDetails, PhoenixEvent, Place, Reduce},
    sdk_client_core::{get_decimal_string, MarketMetadata, PhoenixOrder, SDKClientCore},
};
use phoenix_types as phoenix;
use phoenix_types::dispatch::*;
use phoenix_types::enums::*;
use phoenix_types::market::*;
use rand::{rngs::StdRng, SeedableRng};
use solana_client::rpc_client::RpcClient;
use solana_program::instruction::Instruction;
use solana_sdk::{
    commitment_config::CommitmentConfig,
    program_pack::Pack,
    pubkey::Pubkey,
    signature::{Signature, Signer},
    signer::keypair::Keypair,
};
use std::{collections::BTreeMap, mem::size_of, ops::DerefMut, sync::Arc};
use std::{ops::Deref, sync::Mutex};

use crate::orderbook::Orderbook;

pub struct SDKClient {
    pub client: EllipsisClient,
    pub core: SDKClientCore,
}

impl Deref for SDKClient {
    type Target = SDKClientCore;

    fn deref(&self) -> &Self::Target {
        &self.core
    }
}

impl DerefMut for SDKClient {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.core
    }
}

impl SDKClient {
    /// RECOMMENDED:
    /// Converts base units to base lots. For example if the base currency was a Widget and you wanted to
    /// convert 3 Widgets to base lots you would call sdk.base_unit_to_base_lots(3.0). This would return
    /// the number of base lots that would be equivalent to 3 Widgets.
    pub fn base_units_to_base_lots(&self, base_units: f64) -> u64 {
        self.core.base_units_to_base_lots(base_units)
    }

    /// RECOMMENDED:
    /// Converts base amount to base lots. For example if the base currency was a Widget with 9 decimals and you wanted to
    /// convert 3 Widgets to base lots you would call sdk.base_amount_to_base_lots(3_000_000_000). This would return
    /// the number of base lots that would be equivalent to 3 Widgets.
    pub fn base_amount_to_base_lots(&self, base_amount: u64) -> u64 {
        self.core.base_amount_to_base_lots(base_amount)
    }

    /// RECOMMENDED:
    /// Converts base lots to base units. For example if the base currency was a Widget where there are
    /// 100 base lots per Widget, you would call sdk.base_lots_to_base_units(300) to convert 300 base lots
    /// to 3 Widgets.
    pub fn base_lots_to_base_amount(&self, base_lots: u64) -> u64 {
        self.core.base_lots_to_base_amount(base_lots)
    }

    /// RECOMMENDED:
    /// Converts quote units to quote lots. For example if the quote currency was USDC you wanted to
    /// convert 3 USDC to quote lots you would call sdk.quote_unit_to_quote_lots(3.0). This would return
    /// the number of quote lots that would be equivalent to 3 USDC.
    pub fn quote_units_to_quote_lots(&self, quote_units: f64) -> u64 {
        self.core.quote_units_to_quote_lots(quote_units)
    }

    /// RECOMMENDED:
    /// Converts quote amount to quote lots. For example if the quote currency was USDC with 6 decimals and you wanted to
    /// convert 3 USDC to quote lots you would call sdk.quote_amount_to_quote_lots(3_000_000). This would return
    /// the number of quote lots that would be equivalent to 3 USDC.
    pub fn quote_amount_to_quote_lots(&self, quote_amount: u64) -> u64 {
        self.core.quote_amount_to_quote_lots(quote_amount)
    }

    /// RECOMMENDED:
    /// Converts quote lots to quote units. For example if the quote currency was USDC there are
    /// 100 quote lots per USDC (each quote lot is worth 0.01 USDC), you would call sdk.quote_lots_to_quote_units(300) to convert 300 quote lots
    /// to an amount equal to 3 USDC (3_000_000).
    pub fn quote_lots_to_quote_amount(&self, quote_lots: u64) -> u64 {
        self.core.quote_lots_to_quote_amount(quote_lots)
    }

    /// Converts a base amount to a floating point number of base units. For example if the base currency
    /// is a Widget where the token has 9 decimals and you wanted to convert a base amount of 1000000000 to
    /// a floating point number of base units you would call sdk.base_amount_to_float(1_000_000_000). This
    /// would return 1.0. This is useful for displaying the base amount in a human readable format.
    pub fn base_amount_to_base_unit_as_float(&self, base_amount: u64) -> f64 {
        self.core.base_amount_to_base_unit_as_float(base_amount)
    }

    /// Converts a quote amount to a floating point number of quote units. For example if the quote currency
    /// is USDC the token has 6 decimals and you wanted to convert a quote amount of 1000000 to
    /// a floating point number of quote units you would call sdk.quote_amount_to_float(1_000_000). This
    /// would return 1.0. This is useful for displaying the quote amount in a human readable format.
    pub fn quote_amount_to_quote_unit_as_float(&self, quote_amount: u64) -> f64 {
        self.core.quote_amount_to_quote_unit_as_float(quote_amount)
    }

    /// Takes in a quote amount and prints it as a human readable string to the console
    pub fn print_quote_amount(&self, quote_amount: u64) {
        self.core.print_quote_amount(quote_amount)
    }

    /// Takes in a base amount and prints it as a human readable string to the console
    pub fn print_base_amount(&self, base_amount: u64) {
        self.core.print_base_amount(base_amount)
    }

    /// Takes in information from a fill event and converts it into the equivalent quote amount
    pub fn fill_event_to_quote_amount(&self, fill: &Fill) -> u64 {
        self.core.fill_event_to_quote_amount(fill)
    }

    /// Takes in tick price and base lots of an order converts it into the equivalent quote amount
    pub fn order_to_quote_amount(&self, base_lots: u64, price_in_ticks: u64) -> u64 {
        self.core.order_to_quote_amount(base_lots, price_in_ticks)
    }

    /// Takes in a price as a floating point number and converts it to a number of ticks (rounded down)
    pub fn float_price_to_ticks(&self, price: f64) -> u64 {
        self.core.float_price_to_ticks(price)
    }

    /// Takes in a price as a floating point number and converts it to a number of ticks (rounded up)
    pub fn float_price_to_ticks_rounded_up(&self, price: f64) -> u64 {
        self.core.float_price_to_ticks_rounded_up(price)
    }

    /// Takes in a number of ticks and converts it to a floating point number price
    pub fn ticks_to_float_price(&self, ticks: u64) -> f64 {
        self.core.ticks_to_float_price(ticks)
    }

    pub fn base_lots_to_base_units_multiplier(&self) -> f64 {
        self.core.base_lots_to_base_units_multiplier()
    }

    pub fn ticks_to_float_price_multiplier(&self) -> f64 {
        self.core.ticks_to_float_price_multiplier()
    }

    pub fn set_payer(&mut self, payer: Keypair) {
        self.core.trader = payer.pubkey();
        self.client.payer = payer;
    }
}

impl SDKClient {
    pub async fn new_from_ellipsis_client(market_key: &Pubkey, client: EllipsisClient) -> Self {
        let market_metadata = Self::get_market_metadata(&client, market_key).await;
        let mut markets = BTreeMap::new();

        markets.insert(*market_key, market_metadata);
        let core = SDKClientCore {
            markets,
            rng: Arc::new(Mutex::new(StdRng::from_entropy())),
            active_market_key: *market_key,
            trader: client.payer.pubkey(),
        };
        SDKClient { client, core }
    }

    pub fn new_from_ellipsis_client_sync(market_key: &Pubkey, client: EllipsisClient) -> Self {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(Self::new_from_ellipsis_client(market_key, client))
    }

    pub async fn new(market_key: &Pubkey, payer: &Keypair, url: &str) -> Self {
        let rpc = RpcClient::new_with_commitment(url, CommitmentConfig::confirmed());
        let client = EllipsisClient::from_rpc(rpc, payer).unwrap(); //fix error handling instead of panic
        let market_metadata = Self::get_market_metadata(&client, market_key).await;
        let mut markets = BTreeMap::new();

        markets.insert(*market_key, market_metadata);
        let core = SDKClientCore {
            markets,
            rng: Arc::new(Mutex::new(StdRng::from_entropy())),
            active_market_key: *market_key,
            trader: client.payer.pubkey(),
        };

        SDKClient { client, core }
    }

    pub fn new_sync(market_key: &Pubkey, payer: &Keypair, url: &str) -> Self {
        let rt = tokio::runtime::Runtime::new().unwrap(); //fix error handling instead of panic
        rt.block_on(Self::new(market_key, payer, url))
    }

    pub fn get_next_client_order_id(&self) -> u128 {
        self.core.get_next_client_order_id()
    }

    pub fn get_trader(&self) -> Pubkey {
        self.core.trader
    }

    pub fn change_active_market(&mut self, market: &Pubkey) -> anyhow::Result<()> {
        if self.core.markets.get(market).is_some() {
            self.core.active_market_key = *market;
            Ok(())
        } else {
            Err(anyhow::Error::msg("Market not found"))
        }
    }

    pub async fn add_market(&mut self, market_key: &Pubkey) -> anyhow::Result<()> {
        let market_metadata = Self::get_market_metadata(&self.client, market_key).await;

        self.core.markets.insert(*market_key, market_metadata);

        Ok(())
    }

    pub fn get_active_market_metadata(&self) -> &MarketMetadata {
        self.core.markets.get(&self.core.active_market_key).unwrap()
    }

    pub async fn get_market_ladder(&self, levels: u64) -> Ladder {
        let mut market_account_data = (self.client.get_account_data(&self.core.active_market_key))
            .await
            .unwrap();
        let (header_bytes, bytes) = market_account_data.split_at_mut(size_of::<MarketHeader>());
        let header = MarketHeader::try_from_slice(header_bytes).unwrap();
        let market = load_with_dispatch_mut(&header.market_params, bytes)
            .unwrap()
            .inner;

        market.get_ladder(levels)
    }

    pub fn get_market_ladder_sync(&self, levels: u64) -> Ladder {
        let rt = tokio::runtime::Runtime::new().unwrap(); //fix error handling instead of panic
        rt.block_on(self.get_market_ladder(levels))
    }

    pub async fn get_market_orderbook(&self) -> Orderbook<FIFOOrderId, PhoenixOrder> {
        let mut market_account_data = (self.client.get_account_data(&self.core.active_market_key))
            .await
            .unwrap();
        let (header_bytes, bytes) = market_account_data.split_at_mut(size_of::<MarketHeader>());
        let header = MarketHeader::try_from_slice(header_bytes).unwrap();
        let market = load_with_dispatch_mut(&header.market_params, bytes)
            .unwrap()
            .inner;
        Orderbook::from_market(
            market,
            self.base_lots_to_base_units_multiplier(),
            self.ticks_to_float_price_multiplier(),
        )
    }

    pub fn get_market_orderbook_sync(&self) -> Orderbook<FIFOOrderId, PhoenixOrder> {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(self.get_market_orderbook())
    }

    pub async fn get_traders(&self) -> BTreeMap<Pubkey, TraderState> {
        let mut market_account_data = (self.client.get_account_data(&self.core.active_market_key))
            .await
            .unwrap();
        let (header_bytes, bytes) = market_account_data.split_at_mut(size_of::<MarketHeader>());
        let header = MarketHeader::try_from_slice(header_bytes).unwrap();
        let market = load_with_dispatch_mut(&header.market_params, bytes)
            .unwrap()
            .inner;

        market
            .get_registered_traders()
            .iter()
            .map(|(k, v)| (*k, *v))
            .collect()
    }

    pub fn get_traders_sync(&self) -> BTreeMap<Pubkey, TraderState> {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(self.get_traders())
    }

    pub async fn get_market_state(&self) -> MarketState {
        let mut market_account_data = (self.client.get_account_data(&self.core.active_market_key))
            .await
            .unwrap();
        let (header_bytes, bytes) = market_account_data.split_at_mut(size_of::<MarketHeader>());
        let header = MarketHeader::try_from_slice(header_bytes).unwrap();
        let market = load_with_dispatch_mut(&header.market_params, bytes)
            .unwrap()
            .inner;

        let orderbook = Orderbook::from_market(
            market,
            self.base_lots_to_base_units_multiplier(),
            self.ticks_to_float_price_multiplier(),
        );

        let traders = market
            .get_registered_traders()
            .iter()
            .map(|(k, v)| (*k, *v))
            .collect();

        MarketState { orderbook, traders }
    }

    #[allow(clippy::useless_conversion)]
    async fn get_market_metadata(client: &EllipsisClient, market_key: &Pubkey) -> MarketMetadata {
        let mut market_account_data = (client.get_account_data(market_key)).await.unwrap();
        let (header_bytes, bytes) = market_account_data.split_at_mut(size_of::<MarketHeader>());
        let header = MarketHeader::try_from_slice(header_bytes).unwrap();
        let market = load_with_dispatch_mut(&header.market_params, bytes)
            .unwrap()
            .inner;

        let base_mint_acct = spl_token::state::Mint::unpack(
            &client
                .get_account_data(&header.base_params.mint_key)
                .await
                .unwrap(),
        )
        .unwrap();
        let quote_mint_acct = spl_token::state::Mint::unpack(
            &client
                .get_account_data(&header.quote_params.mint_key)
                .await
                .unwrap(),
        )
        .unwrap();

        let quote_lot_size = header.get_quote_lot_size().into();
        let base_lot_size = header.get_base_lot_size().into();
        let quote_multiplier = 10u64.pow(quote_mint_acct.decimals as u32);
        let base_multiplier = 10u64.pow(base_mint_acct.decimals as u32);
        let base_mint = header.base_params.mint_key;
        let quote_mint = header.quote_params.mint_key;
        let tick_size = header.get_tick_size().into();
        let num_base_lots_per_base_unit = market.get_base_lots_per_base_unit().into();
        let num_quote_lots_per_tick = market.get_quote_lots_per_tick().into();

        MarketMetadata {
            base_mint,
            quote_mint,
            base_decimals: base_mint_acct.decimals as u32,
            quote_decimals: quote_mint_acct.decimals as u32,
            base_multiplier,
            quote_multiplier,
            tick_size,
            quote_lot_size,
            base_lot_size,
            num_base_lots_per_base_unit,
            num_quote_lots_per_tick,
        }
    }

    pub async fn parse_events_from_transaction(
        &self,
        sig: &Signature,
    ) -> Option<Vec<PhoenixEvent>> {
        let tx = self.client.get_transaction(sig).await.ok()?;
        let mut event_list = vec![];
        for inner_ixs in tx.inner_instructions.iter() {
            let mut in_cpi = false;
            for inner_ix in inner_ixs.iter() {
                let parent_program_id = tx.instructions[inner_ix.parent_index].program_id.clone();
                let current_program_id = inner_ix.instruction.program_id.clone();
                let called_by_phoenix = parent_program_id == phoenix::id().to_string();
                let is_wrapper_program = current_program_id == spl_noop::id().to_string();
                // Not comprehensive, but should be good enough for now
                if current_program_id == phoenix::id().to_string() {
                    // if current_program_id is the Phoenix program, we know that the instruction is a CPI
                    in_cpi = true;
                } else if in_cpi
                    && ![spl_token::id().to_string(), spl_noop::id().to_string()]
                        .contains(&current_program_id)
                {
                    // if we are in a CPI and current_program_id is not a token or noop program,
                    // we know that the CPI has completed
                    in_cpi = false;
                }
                if (called_by_phoenix || in_cpi) && is_wrapper_program {
                    event_list.push(inner_ix.instruction.data.clone());
                }
            }
        }
        self.parse_wrapper_events(sig, event_list)
    }

    pub async fn parse_places(&self, signature: &Signature) -> Vec<PhoenixEvent> {
        let events = self
            .parse_events_from_transaction(signature)
            .await
            .unwrap_or_default();
        events
            .iter()
            .filter_map(|&event| match event.details {
                MarketEventDetails::Place(..) => Some(event),
                _ => None,
            })
            .collect::<Vec<PhoenixEvent>>()
    }

    pub async fn parse_cancels(&self, signature: &Signature) -> Vec<PhoenixEvent> {
        let events = self
            .parse_events_from_transaction(signature)
            .await
            .unwrap_or_default();
        events
            .iter()
            .filter_map(|&event| match event.details {
                MarketEventDetails::Reduce(..) => Some(event),
                _ => None,
            })
            .collect::<Vec<PhoenixEvent>>()
    }

    pub async fn parse_fills(&self, signature: &Signature) -> Vec<PhoenixEvent> {
        let events = self
            .parse_events_from_transaction(signature)
            .await
            .unwrap_or_default();
        events
            .iter()
            .filter_map(|&event| match event.details {
                MarketEventDetails::Fill(..) => Some(event),
                _ => None,
            })
            .collect::<Vec<PhoenixEvent>>()
    }

    pub async fn parse_fills_and_places(
        &self,
        signature: &Signature,
    ) -> (Vec<PhoenixEvent>, Vec<PhoenixEvent>) {
        let events = self
            .parse_events_from_transaction(signature)
            .await
            .unwrap_or_default();
        let fills = events
            .iter()
            .filter_map(|&event| match event.details {
                MarketEventDetails::Fill(..) => Some(event),
                _ => None,
            })
            .collect::<Vec<PhoenixEvent>>();
        let places = events
            .iter()
            .filter_map(|&event| match event.details {
                MarketEventDetails::Place(..) => Some(event),
                _ => None,
            })
            .collect::<Vec<PhoenixEvent>>();

        (fills, places)
    }

    fn parse_wrapper_events(
        &self,
        sig: &Signature,
        events: Vec<Vec<u8>>,
    ) -> Option<Vec<PhoenixEvent>> {
        self.core.parse_wrapper_events(sig, events)
    }

    pub async fn send_ioc(
        &self,
        price: u64,
        side: Side,
        size: u64,
    ) -> Option<(Signature, Vec<PhoenixEvent>)> {
        let new_order_ix = self.get_ioc_ix(price, side, size);
        let signature = self
            .client
            .sign_send_instructions(vec![new_order_ix], vec![])
            .await
            .ok()?;
        let fills = self.parse_fills(&signature).await;
        Some((signature, fills))
    }

    pub fn get_ioc_ix(&self, price: u64, side: Side, num_base_lots: u64) -> Instruction {
        self.get_ioc_generic_ix(price, side, num_base_lots, None, None, None, None)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn get_ioc_generic_ix(
        &self,
        price: u64,
        side: Side,
        num_base_lots: u64,
        self_trade_behavior: Option<SelfTradeBehavior>,
        match_limit: Option<u64>,
        client_order_id: Option<u128>,
        use_only_deposited_funds: Option<bool>,
    ) -> Instruction {
        self.core.get_ioc_generic_ix(
            price,
            side,
            num_base_lots,
            self_trade_behavior,
            match_limit,
            client_order_id,
            use_only_deposited_funds,
        )
    }

    pub async fn send_fok_buy(
        &self,
        price: u64,
        size_in_quote_lots: u64,
    ) -> Option<(Signature, Vec<PhoenixEvent>)> {
        let new_order_ix = self.get_fok_buy_ix(price, size_in_quote_lots);

        let signature = self
            .client
            .sign_send_instructions(vec![new_order_ix], vec![])
            .await
            .ok()?;
        let fills = self.parse_fills(&signature).await;
        Some((signature, fills))
    }

    pub async fn send_fok_sell(
        &self,
        price: u64,
        size_in_base_lots: u64,
    ) -> Option<(Signature, Vec<PhoenixEvent>)> {
        let new_order_ix = self.get_fok_sell_ix(price, size_in_base_lots);

        let signature = self
            .client
            .sign_send_instructions(vec![new_order_ix], vec![])
            .await
            .ok()?;
        let fills = self.parse_fills(&signature).await;
        Some((signature, fills))
    }

    pub fn get_fok_buy_ix(&self, price: u64, size_in_quote_lots: u64) -> Instruction {
        self.get_fok_generic_ix(price, Side::Bid, size_in_quote_lots, None, None, None, None)
    }

    pub fn get_fok_sell_ix(&self, price: u64, size_in_base_lots: u64) -> Instruction {
        self.get_fok_generic_ix(price, Side::Ask, size_in_base_lots, None, None, None, None)
    }

    pub fn get_fok_buy_generic_ix(
        &self,
        price: u64,
        size_in_quote_lots: u64,
        self_trade_behavior: Option<SelfTradeBehavior>,
        match_limit: Option<u64>,
        client_order_id: Option<u128>,
        use_only_deposited_funds: Option<bool>,
    ) -> Instruction {
        self.core.get_fok_buy_generic_ix(
            price,
            size_in_quote_lots,
            self_trade_behavior,
            match_limit,
            client_order_id,
            use_only_deposited_funds,
        )
    }

    pub fn get_fok_sell_generic_ix(
        &self,
        price: u64,
        size_in_base_lots: u64,
        self_trade_behavior: Option<SelfTradeBehavior>,
        match_limit: Option<u64>,
        client_order_id: Option<u128>,
        use_only_deposited_funds: Option<bool>,
    ) -> Instruction {
        self.core.get_fok_sell_generic_ix(
            price,
            size_in_base_lots,
            self_trade_behavior,
            match_limit,
            client_order_id,
            use_only_deposited_funds,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn get_fok_generic_ix(
        &self,
        price: u64,
        side: Side,
        size: u64,
        self_trade_behavior: Option<SelfTradeBehavior>,
        match_limit: Option<u64>,
        client_order_id: Option<u128>,
        use_only_deposited_funds: Option<bool>,
    ) -> Instruction {
        self.core.get_fok_generic_ix(
            price,
            side,
            size,
            self_trade_behavior,
            match_limit,
            client_order_id,
            use_only_deposited_funds,
        )
    }

    pub async fn send_ioc_with_slippage(
        &self,
        lots_in: u64,
        min_lots_out: u64,
        side: Side,
    ) -> Option<(Signature, Vec<PhoenixEvent>)> {
        let new_order_ix = self.get_ioc_with_slippage_ix(lots_in, min_lots_out, side);
        let signature = self
            .client
            .sign_send_instructions(vec![new_order_ix], vec![])
            .await
            .ok()?;
        let fills = self.parse_fills(&signature).await;
        Some((signature, fills))
    }

    pub fn get_ioc_with_slippage_ix(
        &self,
        lots_in: u64,
        min_lots_out: u64,
        side: Side,
    ) -> Instruction {
        self.core
            .get_ioc_with_slippage_ix(lots_in, min_lots_out, side)
    }

    pub fn get_ioc_from_tick_price_ix(
        &self,
        tick_price: u64,
        side: Side,
        size: u64,
    ) -> Instruction {
        self.core.get_ioc_from_tick_price_ix(tick_price, side, size)
    }

    pub async fn send_post_only(
        &self,
        price: u64,
        side: Side,
        size: u64,
    ) -> Option<(Signature, Vec<PhoenixEvent>)> {
        let new_order_ix = self.get_post_only_ix(price, side, size);
        let signature = self
            .client
            .sign_send_instructions(vec![new_order_ix], vec![])
            .await
            .ok()?;
        let fills = self.parse_fills(&signature).await;
        Some((signature, fills))
    }

    pub fn get_post_only_ix(&self, price: u64, side: Side, size: u64) -> Instruction {
        self.get_post_only_generic_ix(price, side, size, None, None, None)
    }

    pub fn get_post_only_generic_ix(
        &self,
        price: u64,
        side: Side,
        size: u64,
        client_order_id: Option<u128>,
        reject_post_only: Option<bool>,
        use_only_deposited_funds: Option<bool>,
    ) -> Instruction {
        self.core.get_post_only_generic_ix(
            price,
            side,
            size,
            client_order_id,
            reject_post_only,
            use_only_deposited_funds,
        )
    }

    pub fn get_post_only_ix_from_tick_price(
        &self,
        tick_price: u64,
        side: Side,
        size: u64,
        client_order_id: u128,
        improve_price_on_cross: bool,
    ) -> Instruction {
        self.core.get_post_only_ix_from_tick_price(
            tick_price,
            side,
            size,
            client_order_id,
            improve_price_on_cross,
        )
    }

    pub async fn send_limit_order(
        &self,
        price: u64,
        side: Side,
        size: u64,
    ) -> Option<(Signature, Vec<PhoenixEvent>, Vec<PhoenixEvent>)> {
        let new_order_ix = self.get_limit_order_ix(price, side, size);
        let signature = self
            .client
            .sign_send_instructions(vec![new_order_ix], vec![])
            .await
            .ok()?;
        let (fills, places) = self.parse_fills_and_places(&signature).await;
        Some((signature, places, fills))
    }

    pub fn get_limit_order_ix(&self, price: u64, side: Side, size: u64) -> Instruction {
        self.get_limit_order_generic_ix(price, side, size, None, None, None, None)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn get_limit_order_generic_ix(
        &self,
        price: u64,
        side: Side,
        size: u64,
        self_trade_behavior: Option<SelfTradeBehavior>,
        match_limit: Option<u64>,
        client_order_id: Option<u128>,
        use_only_deposited_funds: Option<bool>,
    ) -> Instruction {
        self.core.get_limit_order_generic_ix(
            price,
            side,
            size,
            self_trade_behavior,
            match_limit,
            client_order_id,
            use_only_deposited_funds,
        )
    }

    pub fn get_limit_order_ix_from_tick_price(
        &self,
        tick_price: u64,
        side: Side,
        size: u64,
        client_order_id: u128,
    ) -> Instruction {
        self.core
            .get_limit_order_ix_from_tick_price(tick_price, side, size, client_order_id)
    }

    pub async fn send_cancel_ids(
        &self,
        ids: Vec<FIFOOrderId>,
    ) -> Option<(Signature, Vec<PhoenixEvent>)> {
        let cancel_ix = self.get_cancel_ids_ix(ids);
        let signature = self
            .client
            .sign_send_instructions(vec![cancel_ix], vec![])
            .await
            .ok()?;

        let cancels = self.parse_cancels(&signature).await;
        Some((signature, cancels))
    }

    pub fn get_cancel_ids_ix(&self, ids: Vec<FIFOOrderId>) -> Instruction {
        self.core.get_cancel_ids_ix(ids)
    }

    pub async fn send_cancel_multiple(
        &self,
        tick_limit: Option<u64>,
        side: Side,
    ) -> Option<(Signature, Vec<PhoenixEvent>)> {
        let cancel_ix = self.get_cancel_multiple_ix(tick_limit, side);
        let signature = self
            .client
            .sign_send_instructions(vec![cancel_ix], vec![])
            .await
            .ok()?;

        let cancels = self.parse_cancels(&signature).await;
        Some((signature, cancels))
    }

    pub fn get_cancel_multiple_ix(&self, tick_limit: Option<u64>, side: Side) -> Instruction {
        self.core.get_cancel_multiple_ix(tick_limit, side)
    }

    pub async fn send_cancel_all(&self) -> Option<(Signature, Vec<PhoenixEvent>)> {
        let cancel_all_ix = self.get_cancel_multiple_ix(None, Side::Bid);
        let signature = self
            .client
            .sign_send_instructions(vec![cancel_all_ix], vec![])
            .await
            .ok()?;

        let cancels = self.parse_cancels(&signature).await;
        Some((signature, cancels))
    }
}
