use ellipsis_client::EllipsisClient;
use phoenix::program::dispatch_market::*;
use phoenix::program::instruction::PhoenixInstruction;
use phoenix::program::MarketHeader;
use phoenix::state::enums::*;
use phoenix::state::markets::*;
use phoenix::state::TraderState;
use phoenix_sdk_core::sdk_client_core::MarketState;
pub use phoenix_sdk_core::{
    market_event::{Evict, Fill, FillSummary, MarketEventDetails, PhoenixEvent, Place, Reduce},
    sdk_client_core::{get_decimal_string, MarketMetadata, PhoenixOrder, SDKClientCore},
};
use rand::{rngs::StdRng, SeedableRng};
use serde::{Deserialize, Serialize};
use solana_client::client_error::reqwest;
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::{
    commitment_config::CommitmentConfig,
    program_pack::Pack,
    pubkey::Pubkey,
    signature::{Signature, Signer},
    signer::keypair::Keypair,
};

use std::collections::HashMap;
use std::str::FromStr;
use std::{collections::BTreeMap, mem::size_of, ops::DerefMut, sync::Arc};
use std::{ops::Deref, sync::Mutex};

use crate::orderbook::Orderbook;

#[derive(Debug, Serialize, Deserialize)]
pub struct JsonMarketConfig {
    pub markets: Vec<String>,
}

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
        let market_metadata = Self::get_market_metadata(&client, market_key).await;
        let mut markets = BTreeMap::new();

        markets.insert(*market_key, market_metadata);
        let core = SDKClientCore {
            markets,
            rng: Arc::new(Mutex::new(StdRng::from_entropy())),
            active_market_key: Some(*market_key),
            trader: client.payer.pubkey(),
        };
        SDKClient { client, core }
    }

    pub async fn new_from_ellipsis_client_without_active_market(client: EllipsisClient) -> Self {
        let markets = BTreeMap::new();

        let core = SDKClientCore {
            markets,
            rng: Arc::new(Mutex::new(StdRng::from_entropy())),
            active_market_key: None,
            trader: client.payer.pubkey(),
        };
        SDKClient { client, core }
    }

    pub fn new_from_ellipsis_client_sync(market_key: &Pubkey, client: EllipsisClient) -> Self {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(Self::new_from_ellipsis_client(market_key, client))
    }

    pub fn new_from_ellipsis_client_without_active_market_sync(client: EllipsisClient) -> Self {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(Self::new_from_ellipsis_client_without_active_market(client))
    }

    pub async fn new(market_key: &Pubkey, payer: &Keypair, url: &str) -> Self {
        let rpc = RpcClient::new_with_commitment(url.to_string(), CommitmentConfig::confirmed());
        let client = EllipsisClient::from_rpc(rpc, payer).expect("Failed to load Ellipsis Client"); //fix error handling instead of panic

        SDKClient::new_from_ellipsis_client(market_key, client).await
    }

    pub async fn new_without_active_market(payer: &Keypair, url: &str) -> Self {
        let rpc = RpcClient::new_with_commitment(url.to_string(), CommitmentConfig::confirmed());
        let client = EllipsisClient::from_rpc(rpc, payer).expect("Failed to load Ellipsis Client"); //fix error handling instead of panic

        SDKClient::new_from_ellipsis_client_without_active_market(client).await
    }

    pub fn new_without_active_market_sync(payer: &Keypair, url: &str) -> Self {
        let rt = tokio::runtime::Runtime::new().unwrap(); //fix error handling instead of panic
        rt.block_on(Self::new_without_active_market(payer, url))
    }

    pub async fn add_all_markets(&mut self, cluster: &str) {
        let cluster = match cluster {
            "dev" | "devnet" | "d" => "devnet",
            "local" | "localhost" | "l" => "localhost",
            "mainnet" | "main" | "mainnet-beta" | "m" => "mainnet-beta",
            _ => panic!("Invalid cluster name. Please use one of the following: devnet, mainnet-beta, localhost")
        };

        let config_url = "https://raw.githubusercontent.com/Ellipsis-Labs/phoenix-sdk/master/typescript/phoenix-sdk/config.json";

        let response = reqwest::get(config_url)
            .await
            .unwrap()
            .json::<HashMap<String, JsonMarketConfig>>()
            .await
            .unwrap();

        let market_details = response.get(cluster).unwrap();
        for market_key in market_details.markets.iter() {
            let market_key = Pubkey::from_str(market_key).unwrap();
            if self.markets.get(&market_key).is_some() {
                continue;
            }
            self.add_market(&market_key).await.unwrap();
        }
    }

    pub fn add_all_markets_sync(&mut self, cluster: &str) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(self.add_all_markets(cluster));
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
            self.active_market_key = Some(*market);
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

    pub async fn add_and_change_active_market(&mut self, market: &Pubkey) -> anyhow::Result<()> {
        if self.markets.get(market).is_some() {
            self.active_market_key = Some(*market);
        } else {
            self.add_market(market).await?;
            self.change_active_market(market)?;
        }

        Ok(())
    }

    pub async fn get_market_ladder(&self, levels: u64) -> Ladder {
        let active_market_key = match self.active_market_key {
            Some(key) => key,
            None => panic!("Active market key not set"),
        };
        self.get_market_ladder_with_market_key(levels, &active_market_key)
            .await
    }

    pub fn get_market_ladder_sync(&self, levels: u64) -> Ladder {
        let rt = tokio::runtime::Runtime::new().unwrap(); //fix error handling instead of panic
        rt.block_on(self.get_market_ladder(levels))
    }

    pub async fn get_market_ladder_with_market_key(
        &self,
        levels: u64,
        market_key: &Pubkey,
    ) -> Ladder {
        let market_account_data = (self.client.get_account_data(market_key))
            .await
            .expect("Failed to get market account data");
        let (header_bytes, bytes) = market_account_data.split_at(size_of::<MarketHeader>());
        let header: &MarketHeader =
            bytemuck::try_from_bytes(header_bytes).expect("Failed to deserialize market header");
        let market = load_with_dispatch(&header.market_size_params, bytes)
            .expect("Market configuration not found")
            .inner;

        market.get_ladder(levels)
    }

    pub fn get_market_ladder_with_market_key_sync(
        &self,
        levels: u64,
        market_key: &Pubkey,
    ) -> Ladder {
        let rt = tokio::runtime::Runtime::new().unwrap(); //fix error handling instead of panic
        rt.block_on(self.get_market_ladder_with_market_key(levels, market_key))
    }

    pub async fn get_market_orderbook(&self) -> Orderbook<FIFOOrderId, PhoenixOrder> {
        let active_market_key = match self.active_market_key {
            Some(key) => key,
            None => panic!("Active market key not set"),
        };
        self.get_market_orderbook_with_market_key(&active_market_key)
            .await
    }

    pub fn get_market_orderbook_sync(&self) -> Orderbook<FIFOOrderId, PhoenixOrder> {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(self.get_market_orderbook())
    }

    pub async fn get_market_orderbook_with_market_key(
        &self,
        market_key: &Pubkey,
    ) -> Orderbook<FIFOOrderId, PhoenixOrder> {
        let market_account_data = (self.client.get_account_data(market_key))
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
        let (header_bytes, bytes) = market_account_data.split_at(size_of::<MarketHeader>());
        bytemuck::try_from_bytes::<MarketHeader>(header_bytes)
            .ok()
            .map(|header| {
                load_with_dispatch(&header.market_size_params, bytes)
                    .map(|market| {
                        Orderbook::from_market(
                            market.inner,
                            self.base_lots_to_base_units_multiplier(),
                            self.ticks_to_float_price_multiplier(),
                        )
                    })
                    .unwrap_or_else(|_| default.clone())
            })
            .unwrap_or(default)
    }

    pub async fn get_market_orderbook_with_market_key_sync(
        &self,
        market_key: &Pubkey,
    ) -> Orderbook<FIFOOrderId, PhoenixOrder> {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(self.get_market_orderbook_with_market_key(market_key))
    }

    pub async fn get_traders(&self) -> BTreeMap<Pubkey, TraderState> {
        let active_market_key = match self.active_market_key {
            Some(key) => key,
            None => panic!("Active market key not set"),
        };
        self.get_traders_with_market_key(&active_market_key).await
    }

    pub fn get_traders_sync(&self) -> BTreeMap<Pubkey, TraderState> {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(self.get_traders())
    }

    pub async fn get_traders_with_market_key(
        &self,
        market_key: &Pubkey,
    ) -> BTreeMap<Pubkey, TraderState> {
        let market_account_data = match (self.client.get_account_data(market_key)).await {
            Ok(data) => data,
            Err(_) => return BTreeMap::new(),
        };
        let (header_bytes, bytes) = market_account_data.split_at(size_of::<MarketHeader>());
        let header = bytemuck::try_from_bytes::<MarketHeader>(header_bytes)
            .expect("Failed to deserialize market header");
        let market = load_with_dispatch(&header.market_size_params, bytes)
            .expect("Market configuration not found")
            .inner;

        market
            .get_registered_traders()
            .iter()
            .map(|(k, v)| (*k, *v))
            .collect()
    }

    pub fn get_traders_with_market_key_sync(
        &self,
        market_key: &Pubkey,
    ) -> BTreeMap<Pubkey, TraderState> {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(self.get_traders_with_market_key(market_key))
    }

    pub async fn get_market_state(&self) -> MarketState {
        let active_market_key = match self.active_market_key {
            Some(key) => key,
            None => panic!("Active market key not set"),
        };
        self.get_market_state_with_market_key(&active_market_key)
            .await
    }

    pub async fn get_market_state_with_market_key(&self, market_key: &Pubkey) -> MarketState {
        let market_account_data = match (self.client.get_account_data(market_key)).await {
            Ok(data) => data,
            Err(_) => {
                return MarketState {
                    orderbook: Orderbook {
                        size_mult: 0.0,
                        price_mult: 0.0,
                        bids: BTreeMap::new(),
                        asks: BTreeMap::new(),
                    },
                    traders: BTreeMap::new(),
                }
            }
        };
        let (header_bytes, bytes) = market_account_data.split_at(size_of::<MarketHeader>());
        let header = bytemuck::try_from_bytes::<MarketHeader>(header_bytes)
            .expect("Failed to deserialize market header");
        let market = load_with_dispatch(&header.market_size_params, bytes)
            .expect("Market configuration not found")
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
        let market_account_data = (client.get_account_data(market_key))
            .await
            .expect("Failed to find market account");
        let (header_bytes, bytes) = market_account_data.split_at(size_of::<MarketHeader>());
        let header = bytemuck::try_from_bytes::<MarketHeader>(header_bytes)
            .expect("Failed to deserialize market header");
        let market = load_with_dispatch(&header.market_size_params, bytes)
            .expect("Market configuration not found")
            .inner;

        let base_mint_acct = spl_token::state::Mint::unpack(
            &client
                .get_account_data(&header.base_params.mint_key)
                .await
                .expect("Failed to find base mint account"),
        )
        .expect("Failed to deserialize base mint account");
        let quote_mint_acct = spl_token::state::Mint::unpack(
            &client
                .get_account_data(&header.quote_params.mint_key)
                .await
                .expect("Failed to find quote mint account"),
        )
        .expect("Failed to deserialize quote mint account");

        let quote_lot_size = header.get_quote_lot_size().into();
        let base_lot_size = header.get_base_lot_size().into();
        let quote_multiplier = 10u64.pow(quote_mint_acct.decimals as u32);
        let base_multiplier = 10u64.pow(base_mint_acct.decimals as u32);
        let base_mint = header.base_params.mint_key;
        let quote_mint = header.quote_params.mint_key;
        let tick_size_in_quote_atoms_per_base_unit =
            header.get_tick_size_in_quote_atoms_per_base_unit().into();
        let num_base_lots_per_base_unit = market.get_base_lots_per_base_unit().into();
        // max(1) is only relevant for old markets where the raw_base_units_per_base_unit was not set
        let raw_base_units_per_base_unit = header.raw_base_units_per_base_unit.max(1);

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
            raw_base_units_per_base_unit,
        }
    }

    pub async fn parse_events_from_transaction(
        &self,
        sig: &Signature,
    ) -> Option<Vec<PhoenixEvent>> {
        let tx = self.client.get_transaction(sig).await.ok()?;
        if tx.is_err {
            return None;
        }
        let mut event_list = vec![];
        for inner_ixs in tx.inner_instructions.iter() {
            for inner_ix in inner_ixs.iter() {
                let current_program_id = inner_ix.instruction.program_id.clone();
                if current_program_id != phoenix::id().to_string() {
                    continue;
                }
                if inner_ix.instruction.data.is_empty() {
                    continue;
                }
                let (tag, data) = match inner_ix.instruction.data.split_first() {
                    Some((tag, data)) => (*tag, data),
                    None => continue,
                };
                let ix_enum = match PhoenixInstruction::try_from(tag).ok() {
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

    pub async fn send_ioc_with_market_key(
        &self,
        market_key: &Pubkey,
        price: u64,
        side: Side,
        size: u64,
    ) -> Option<(Signature, Vec<PhoenixEvent>)> {
        let new_order_ix = self.get_ioc_ix_with_market_key(market_key, price, side, size);
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

    pub async fn send_fok_buy_with_market_key(
        &self,
        market_key: &Pubkey,
        price: u64,
        size_in_quote_lots: u64,
    ) -> Option<(Signature, Vec<PhoenixEvent>)> {
        let new_order_ix =
            self.get_fok_buy_ix_with_market_key(market_key, price, size_in_quote_lots);

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

    pub async fn send_fok_sell_with_market_key(
        &self,
        market_key: &Pubkey,
        price: u64,
        size_in_base_lots: u64,
    ) -> Option<(Signature, Vec<PhoenixEvent>)> {
        let new_order_ix =
            self.get_fok_sell_ix_with_market_key(market_key, price, size_in_base_lots);

        let signature = self
            .client
            .sign_send_instructions(vec![new_order_ix], vec![])
            .await
            .ok()?;
        let fills = self.parse_fills(&signature).await;
        Some((signature, fills))
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

    pub async fn send_ioc_with_slippage_with_market_key(
        &self,
        market_key: &Pubkey,
        lots_in: u64,
        min_lots_out: u64,
        side: Side,
    ) -> Option<(Signature, Vec<PhoenixEvent>)> {
        let new_order_ix =
            self.get_ioc_with_slippage_ix_with_market_key(market_key, lots_in, min_lots_out, side);
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

    pub async fn send_post_only_with_market_key(
        &self,
        market_key: &Pubkey,
        price: u64,
        side: Side,
        size: u64,
    ) -> Option<(Signature, Vec<PhoenixEvent>)> {
        let new_order_ix = self.get_post_only_ix_with_market_key(market_key, price, side, size);
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

    pub async fn send_limit_order_with_market_key(
        &self,
        market_key: &Pubkey,
        price: u64,
        side: Side,
        size: u64,
    ) -> Option<(Signature, Vec<PhoenixEvent>, Vec<PhoenixEvent>)> {
        let new_order_ix = self.get_limit_order_ix_with_market_key(market_key, price, side, size);
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

    pub async fn send_cancel_ids_with_market_key(
        &self,
        market_key: &Pubkey,
        ids: Vec<FIFOOrderId>,
    ) -> Option<(Signature, Vec<PhoenixEvent>)> {
        let cancel_ix = self.get_cancel_ids_ix_with_market_key(market_key, ids);
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

    pub async fn send_cancel_up_to_with_market_key(
        &self,
        market_key: &Pubkey,
        tick_limit: Option<u64>,
        side: Side,
    ) -> Option<(Signature, Vec<PhoenixEvent>)> {
        let cancel_ix = self.get_cancel_up_to_ix_with_market_key(market_key, tick_limit, side);
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

    pub async fn send_cancel_all_with_market_key(
        &self,
        market_key: &Pubkey,
    ) -> Option<(Signature, Vec<PhoenixEvent>)> {
        let cancel_all_ix = self.get_cancel_all_ix_with_market_key(market_key);
        let signature = self
            .client
            .sign_send_instructions(vec![cancel_all_ix], vec![])
            .await
            .ok()?;

        let cancels = self.parse_cancels(&signature).await;
        Some((signature, cancels))
    }
}
