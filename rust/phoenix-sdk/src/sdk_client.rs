use borsh::BorshDeserialize;
use ellipsis_client::{transaction_utils::parse_transaction, EllipsisClient};
use phoenix_sdk_core::sdk_client_core::MarketState;
pub use phoenix_sdk_core::{
    market_event::{Evict, Fill, FillSummary, MarketEventDetails, PhoenixEvent, Place, Reduce},
    sdk_client_core::{get_decimal_string, MarketMetadata, PhoenixOrder, SDKClientCore},
};
use phoenix_types as phoenix;
use phoenix_types::dispatch::*;
use phoenix_types::enums::*;
use phoenix_types::instructions::PhoenixInstruction;
use phoenix_types::market::*;
use rand::{rngs::StdRng, SeedableRng};
use solana_client::{rpc_client::RpcClient, rpc_config::RpcTransactionConfig};
use solana_program::instruction::Instruction;
use solana_sdk::{
    commitment_config::CommitmentConfig,
    program_pack::Pack,
    pubkey::Pubkey,
    signature::{Signature, Signer},
    signer::keypair::Keypair,
};
use solana_transaction_status::UiTransactionEncoding;
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
    pub async fn new_from_ellipsis_client(market_key: &Pubkey, client: EllipsisClient) -> Self {
        SDKClient::new_from_ellipsis_client_with_custom_program_id(
            market_key,
            client,
            &phoenix::id(),
        )
        .await
    }

    pub async fn new_from_ellipsis_client_with_custom_program_id(
        market_key: &Pubkey,
        client: EllipsisClient,
        program_id: &Pubkey,
    ) -> Self {
        let market_metadata = Self::get_market_metadata(&client, market_key).await;
        let mut markets = BTreeMap::new();

        markets.insert(*market_key, market_metadata);
        let core = SDKClientCore {
            markets,
            rng: Arc::new(Mutex::new(StdRng::from_entropy())),
            active_market_key: *market_key,
            trader: client.payer.pubkey(),
            program_id: *program_id,
        };
        SDKClient { client, core }
    }

    pub fn new_from_ellipsis_client_sync(market_key: &Pubkey, client: EllipsisClient) -> Self {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(Self::new_from_ellipsis_client(market_key, client))
    }

    pub fn new_from_ellipsis_client_with_custom_program_id_sync(
        market_key: &Pubkey,
        client: EllipsisClient,
        program_id: &Pubkey,
    ) -> Self {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(Self::new_from_ellipsis_client_with_custom_program_id(
            market_key, client, program_id,
        ))
    }

    pub async fn new(market_key: &Pubkey, payer: &Keypair, url: &str) -> Self {
        let rpc = RpcClient::new_with_commitment(url, CommitmentConfig::confirmed());
        let client = EllipsisClient::from_rpc(rpc, payer).unwrap(); //fix error handling instead of panic

        SDKClient::new_from_ellipsis_client(market_key, client).await
    }

    pub async fn new_with_custom_program_id(
        market_key: &Pubkey,
        payer: &Keypair,
        url: &str,
        program_id: &Pubkey,
    ) -> Self {
        let rpc = RpcClient::new_with_commitment(url, CommitmentConfig::confirmed());
        let client = EllipsisClient::from_rpc(rpc, payer).unwrap(); //fix error handling instead of panic

        SDKClient::new_from_ellipsis_client_with_custom_program_id(market_key, client, program_id)
            .await
    }

    pub fn new_sync(market_key: &Pubkey, payer: &Keypair, url: &str) -> Self {
        let rt = tokio::runtime::Runtime::new().unwrap(); //fix error handling instead of panic
        rt.block_on(Self::new(market_key, payer, url))
    }

    pub fn new_with_custom_program_id_sync(
        market_key: &Pubkey,
        payer: &Keypair,
        url: &str,
        program_id: &Pubkey,
    ) -> Self {
        let rt = tokio::runtime::Runtime::new().unwrap(); //fix error handling instead of panic
        rt.block_on(Self::new_with_custom_program_id(
            market_key, payer, url, program_id,
        ))
    }

    pub fn set_payer(&mut self, payer: Keypair) {
        self.trader = payer.pubkey();
        self.client.payer = payer;
    }

    pub fn get_trader(&self) -> Pubkey {
        self.trader
    }

    pub fn change_active_market(&mut self, market: &Pubkey) -> anyhow::Result<()> {
        if self.markets.get(market).is_some() {
            self.active_market_key = *market;
            Ok(())
        } else {
            Err(anyhow::Error::msg("Market not found"))
        }
    }

    pub async fn add_market(&mut self, market_key: &Pubkey) -> anyhow::Result<()> {
        let market_metadata = Self::get_market_metadata(&self.client, market_key).await;

        self.markets.insert(*market_key, market_metadata);

        Ok(())
    }

    pub async fn get_market_ladder(&self, levels: u64) -> Ladder {
        let mut market_account_data = (self.client.get_account_data(&self.active_market_key))
            .await
            .unwrap();
        let (header_bytes, bytes) = market_account_data.split_at_mut(size_of::<MarketHeader>());
        let header = MarketHeader::try_from_slice(header_bytes).unwrap();
        let market = load_with_dispatch_mut(&header.market_size_params, bytes)
            .unwrap()
            .inner;

        market.get_ladder(levels)
    }

    pub fn get_market_ladder_sync(&self, levels: u64) -> Ladder {
        let rt = tokio::runtime::Runtime::new().unwrap(); //fix error handling instead of panic
        rt.block_on(self.get_market_ladder(levels))
    }

    pub async fn get_market_orderbook(&self) -> Orderbook<FIFOOrderId, PhoenixOrder> {
        let mut market_account_data = (self.client.get_account_data(&self.active_market_key))
            .await
            .unwrap_or_default();
        let default = Orderbook::<FIFOOrderId, PhoenixOrder> {
            size_mult: 0.0,
            price_mult: 0.0,
            bids: BTreeMap::new(),
            asks: BTreeMap::new(),
        };
        if market_account_data.is_empty() {
            return default;
        }
        let (header_bytes, bytes) = market_account_data.split_at_mut(size_of::<MarketHeader>());
        MarketHeader::try_from_slice(header_bytes)
            .ok()
            .map(|header| {
                load_with_dispatch_mut(&header.market_size_params, bytes)
                    .map(|market| {
                        Orderbook::from_market(
                            market.inner,
                            self.base_lots_to_base_units_multiplier(),
                            self.ticks_to_float_price_multiplier(),
                        )
                    })
                    .unwrap_or_else(|| default.clone())
            })
            .unwrap_or(default)
    }

    pub fn get_market_orderbook_sync(&self) -> Orderbook<FIFOOrderId, PhoenixOrder> {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(self.get_market_orderbook())
    }

    pub async fn get_traders(&self) -> BTreeMap<Pubkey, TraderState> {
        let mut market_account_data = (self.client.get_account_data(&self.active_market_key))
            .await
            .unwrap();
        let (header_bytes, bytes) = market_account_data.split_at_mut(size_of::<MarketHeader>());
        let header = MarketHeader::try_from_slice(header_bytes).unwrap();
        let market = load_with_dispatch_mut(&header.market_size_params, bytes)
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
        let mut market_account_data = (self.client.get_account_data(&self.active_market_key))
            .await
            .unwrap();
        let (header_bytes, bytes) = market_account_data.split_at_mut(size_of::<MarketHeader>());
        let header = MarketHeader::try_from_slice(header_bytes).unwrap();
        let market = load_with_dispatch_mut(&header.market_size_params, bytes)
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
        let market = load_with_dispatch_mut(&header.market_size_params, bytes)
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
        let tick_size_in_quote_atoms_per_base_unit =
            header.get_tick_size_in_quote_atoms_per_base_unit().into();
        let num_base_lots_per_base_unit = market.get_base_lots_per_base_unit().into();

        MarketMetadata {
            base_mint,
            quote_mint,
            base_decimals: base_mint_acct.decimals as u32,
            quote_decimals: quote_mint_acct.decimals as u32,
            base_multiplier,
            quote_multiplier,
            tick_size_in_quote_atoms_per_base_unit,
            quote_lot_size,
            base_lot_size,
            num_base_lots_per_base_unit,
        }
    }

    pub async fn parse_events_from_transaction(
        &self,
        sig: &Signature,
    ) -> Option<Vec<PhoenixEvent>> {
        let tx = self.client.get_transaction(sig).await.ok()?;
        let mut event_list = vec![];
        for inner_ixs in tx.inner_instructions.iter() {
            for inner_ix in inner_ixs.iter() {
                let current_program_id = inner_ix.instruction.program_id.clone();
                if current_program_id != self.program_id.to_string() {
                    continue;
                }
                if inner_ix.instruction.data.is_empty() {
                    continue;
                }
                let (tag, data) = inner_ix.instruction.data.split_first().unwrap();
                let ix_enum = match PhoenixInstruction::try_from(*tag).ok() {
                    Some(ix) => ix,
                    None => continue,
                };
                if matches!(ix_enum, PhoenixInstruction::Log) {
                    event_list.push(data.to_vec());
                }
            }
        }
        self.parse_phoenix_events(sig, event_list)
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

    pub async fn send_cancel_up_to(
        &self,
        tick_limit: Option<u64>,
        side: Side,
    ) -> Option<(Signature, Vec<PhoenixEvent>)> {
        let cancel_ix = self.get_cancel_up_to_ix(tick_limit, side);
        let signature = self
            .client
            .sign_send_instructions(vec![cancel_ix], vec![])
            .await
            .ok()?;

        let cancels = self.parse_cancels(&signature).await;
        Some((signature, cancels))
    }

    pub async fn send_cancel_all(&self) -> Option<(Signature, Vec<PhoenixEvent>)> {
        let cancel_all_ix = self.get_cancel_all_ix();
        let signature = self
            .client
            .sign_send_instructions(vec![cancel_all_ix], vec![])
            .await
            .ok()?;

        let cancels = self.parse_cancels(&signature).await;
        Some((signature, cancels))
    }
}
