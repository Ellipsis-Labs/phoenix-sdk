use anyhow::anyhow;
use anyhow::Result;
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
use std::{collections::BTreeMap, mem::size_of, ops::DerefMut};
use std::{ops::Deref};

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
    /// Create a new SDKClient from an EllipsisClient.
    /// This does not have any markets added to it. You must call `add_market` or `add_all_markets` to
    /// add markets to the SDKClient.
    pub async fn new_from_ellipsis_client(client: EllipsisClient) -> Result<Self> {
        let markets = BTreeMap::new();

        let core = SDKClientCore {
            markets,
            trader: client.payer.pubkey(),
        };
        Ok(SDKClient { client, core })
    }

    /// Create a new SDKClient from an EllipsisClient.
    /// This does not have any markets added to it. You must call `add_market` or `add_all_markets` to
    /// add markets to the SDKClient.
    pub fn new_from_ellipsis_client_sync(client: EllipsisClient) -> Result<Self> {
        let rt = tokio::runtime::Runtime::new()?;
        rt.block_on(Self::new_from_ellipsis_client(client))
    }

    /// Recommended way to create a new SDKClient from an EllipsisClient.
    /// This will use a list of markets from a pre-defined config file to add all known markets to the SDKClient.
    pub async fn new_from_ellipsis_client_with_all_markets(client: EllipsisClient) -> Result<Self> {
        let markets = BTreeMap::new();

        let core = SDKClientCore {
            markets,
            trader: client.payer.pubkey(),
        };
        println!("Creating SDKClient with all markets");
        let mut sdk = SDKClient { client, core };
        sdk.add_all_markets().await?;
        Ok(sdk)
    }

    /// Recommended way to create a new SDKClient from an EllipsisClient.
    /// This will use a list of markets from a pre-defined config file to add all known markets to the SDKClient.
    pub fn new_from_ellipsis_client_with_all_markets_sync(client: EllipsisClient) -> Result<Self> {
        let rt = tokio::runtime::Runtime::new()?;
        rt.block_on(Self::new_from_ellipsis_client_with_all_markets(client))
    }

    /// Create a new SDKClient from an EllipsisClient.
    /// Pass in a list of market keys to add to the SDKClient.
    pub async fn new_from_ellipsis_client_with_market_keys(
        market_keys: Vec<&Pubkey>,
        client: EllipsisClient,
    ) -> Result<Self> {
        let mut markets = BTreeMap::new();
        for market_key in market_keys {
            let market_metadata = Self::get_market_metadata(&client, market_key).await?;
            markets.insert(*market_key, market_metadata);
        }
        let core = SDKClientCore {
            markets,
            trader: client.payer.pubkey(),
        };
        Ok(SDKClient { client, core })
    }

    /// Create a new SDKClient from an EllipsisClient.
    /// Pass in a list of market keys to add to the SDKClient.
    pub fn new_from_ellipsis_client_sync_with_market_keys(
        market_keys: Vec<&Pubkey>,
        client: EllipsisClient,
    ) -> Result<Self> {
        let rt = tokio::runtime::Runtime::new()?;
        rt.block_on(Self::new_from_ellipsis_client_with_market_keys(
            market_keys,
            client,
        ))
    }

    /// Create a new SDKClient.
    /// This does not have any markets added to it. You must call `add_market` or `add_all_markets` to
    /// add markets to the SDKClient.
    pub async fn new(payer: &Keypair, url: &str) -> Result<Self> {
        let rpc = RpcClient::new_with_commitment(url.to_string(), CommitmentConfig::confirmed());
        let client = EllipsisClient::from_rpc(rpc, payer)?;

        SDKClient::new_from_ellipsis_client(client).await
    }

    /// Create a new SDKClient.
    /// This does not have any markets added to it. You must call `add_market` or `add_all_markets` to
    /// add markets to the SDKClient.
    pub fn new_sync(payer: &Keypair, url: &str) -> Result<Self> {
        let rt = tokio::runtime::Runtime::new()?;
        rt.block_on(Self::new(payer, url))
    }

    /// Recommended way to create a new SDKClient.
    /// This will use a list of markets from a pre-defined config file to add all known markets to the SDKClient.
    pub async fn new_with_all_markets(payer: &Keypair, url: &str) -> Result<Self> {
        let rpc = RpcClient::new_with_commitment(url.to_string(), CommitmentConfig::confirmed());
        let client = EllipsisClient::from_rpc(rpc, payer)?;

        SDKClient::new_from_ellipsis_client_with_all_markets(client).await
    }

    /// Recommended way to create a new SDKClient.
    /// This will use a list of markets from a pre-defined config file to add all known markets to the SDKClient.
    pub fn new_with_all_markets_sync(payer: &Keypair, url: &str) -> Result<Self> {
        let rt = tokio::runtime::Runtime::new()?;
        rt.block_on(Self::new_with_all_markets(payer, url))
    }

    /// Create a new SDKClient.
    /// Pass in a list of market keys to add to the SDKClient.
    pub async fn new_with_market_keys(
        market_keys: Vec<&Pubkey>,
        payer: &Keypair,
        url: &str,
    ) -> Result<Self> {
        let rpc = RpcClient::new_with_commitment(url.to_string(), CommitmentConfig::confirmed());
        let client = EllipsisClient::from_rpc(rpc, payer)?;

        SDKClient::new_from_ellipsis_client_with_market_keys(market_keys, client).await
    }

    /// Create a new SDKClient.
    /// Pass in a list of market keys to add to the SDKClient.
    pub fn new_with_market_keys_sync(
        market_keys: Vec<&Pubkey>,
        payer: &Keypair,
        url: &str,
    ) -> Result<Self> {
        let rt = tokio::runtime::Runtime::new()?;
        rt.block_on(Self::new_with_market_keys(market_keys, payer, url))
    }

    /// Load in all known markets from a pre-defined config file located in the SDK github.
    pub async fn add_all_markets(&mut self) -> Result<()> {
        let config_url = "https://raw.githubusercontent.com/Ellipsis-Labs/phoenix-sdk/master/typescript/phoenix-sdk/config.json";

        let genesis = self.client.get_genesis_hash().await?;

        //hardcoded in the genesis hashes for mainnet and devnet
        let cluster = match genesis.to_string().as_str() {
            "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d" => "mainnet-beta",
            "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG" => "devnet",
            _ => "localhost",
        };

        let response = reqwest::get(config_url)
            .await
            .map_err(|e| anyhow!("Failed to get config file: {}", e))?
            .json::<HashMap<String, JsonMarketConfig>>()
            .await
            .map_err(|e| anyhow!("Failed to parse config file: {}", e))?;

        let market_details = response.get(cluster).ok_or(anyhow!(
            "Failed to find cluster {} in config file",
            cluster
        ))?;

        for market_key in market_details.markets.iter() {
            let market_key = Pubkey::from_str(market_key).map_err(|e| anyhow!(e))?;
            if self.markets.get(&market_key).is_some() {
                continue;
            }
            self.add_market(&market_key).await.map_err(|e| anyhow!(e))?;
        }

        Ok(())
    }

    pub fn add_all_markets_sync(&mut self) -> Result<()> {
        let rt = tokio::runtime::Runtime::new()?;
        rt.block_on(self.add_all_markets())
    }

    pub async fn add_market(&mut self, market_key: &Pubkey) -> anyhow::Result<()> {
        let market_metadata = Self::get_market_metadata(&self.client, market_key).await?;
        self.markets.insert(*market_key, market_metadata);

        Ok(())
    }

    pub fn set_payer(&mut self, payer: Keypair) {
        self.trader = payer.pubkey();
        self.client.payer = payer;
    }

    pub fn set_trader(&mut self, trader: Pubkey) {
        self.trader = trader;
    }

    pub fn get_trader(&self) -> Pubkey {
        self.trader
    }

    pub async fn get_market_ladder(&self, market_key: &Pubkey, levels: u64) -> Result<Ladder> {
        let market_account_data = (self.client.get_account_data(market_key))
            .await
            .map_err(|_| anyhow!("Failed to get market account data"))?;
        let (header_bytes, bytes) = market_account_data.split_at(size_of::<MarketHeader>());
        let header: &MarketHeader =
            bytemuck::try_from_bytes(header_bytes).expect("Failed to deserialize market header");
        let market = load_with_dispatch(&header.market_size_params, bytes)
            .map_err(|_| anyhow!("Market configuration not found"))?
            .inner;

        Ok(market.get_ladder(levels))
    }

    pub fn get_market_ladder_sync(&self, market_key: &Pubkey, levels: u64) -> Result<Ladder> {
        let rt = tokio::runtime::Runtime::new()?; //fix error handling instead of panic
        rt.block_on(self.get_market_ladder(market_key, levels))
    }

    pub async fn get_market_orderbook(
        &self,
        market_key: &Pubkey,
    ) -> Result<Orderbook<FIFOOrderId, PhoenixOrder>> {
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
            return Ok(default);
        }
        let (header_bytes, bytes) = market_account_data.split_at(size_of::<MarketHeader>());
        let base_lots_multiplier = self.base_lots_to_base_units_multiplier(market_key)?;
        let ticks_multiplier = self.ticks_to_float_price_multiplier(market_key)?;
        Ok(bytemuck::try_from_bytes::<MarketHeader>(header_bytes)
            .ok()
            .map(|header| {
                load_with_dispatch(&header.market_size_params, bytes)
                    .map(|market| {
                        Orderbook::from_market(market.inner, base_lots_multiplier, ticks_multiplier)
                    })
                    .unwrap_or_else(|_| default.clone())
            })
            .unwrap_or(default))
    }

    pub async fn get_market_orderbook_sync(
        &self,
        market_key: &Pubkey,
    ) -> Result<Orderbook<FIFOOrderId, PhoenixOrder>> {
        let rt = tokio::runtime::Runtime::new()?;
        rt.block_on(self.get_market_orderbook(market_key))
    }

    pub async fn get_traders_with_market_key(
        &self,
        market_key: &Pubkey,
    ) -> Result<BTreeMap<Pubkey, TraderState>> {
        let market_account_data = match (self.client.get_account_data(market_key)).await {
            Ok(data) => data,
            Err(_) => return Ok(BTreeMap::new()),
        };
        let (header_bytes, bytes) = market_account_data.split_at(size_of::<MarketHeader>());
        let header = bytemuck::try_from_bytes::<MarketHeader>(header_bytes)
            .map_err(|_| anyhow!("Failed to deserialize market header"))?; 
        let market = load_with_dispatch(&header.market_size_params, bytes)
            .map_err(|_| anyhow!("Market configuration not found"))?
            .inner;

        Ok(market
            .get_registered_traders()
            .iter()
            .map(|(k, v)| (*k, *v))
            .collect())
    }

    pub fn get_traders_with_market_key_sync(
        &self,
        market_key: &Pubkey,
    ) -> Result<BTreeMap<Pubkey, TraderState>> {
        let rt = tokio::runtime::Runtime::new()?;
        rt.block_on(self.get_traders_with_market_key(market_key))
    }

    pub async fn get_market_state(&self, market_key: &Pubkey) -> Result<MarketState> {
        let market_account_data = match (self.client.get_account_data(market_key)).await {
            Ok(data) => data,
            Err(_) => {
                return Ok(MarketState {
                    orderbook: Orderbook {
                        size_mult: 0.0,
                        price_mult: 0.0,
                        bids: BTreeMap::new(),
                        asks: BTreeMap::new(),
                    },
                    traders: BTreeMap::new(),
                })
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
            self.base_lots_to_base_units_multiplier(market_key)?,
            self.ticks_to_float_price_multiplier(market_key)?,
        );

        let traders = market
            .get_registered_traders()
            .iter()
            .map(|(k, v)| (*k, *v))
            .collect();

        Ok(MarketState { orderbook, traders })
    }

    #[allow(clippy::useless_conversion)]
    async fn get_market_metadata(
        client: &EllipsisClient,
        market_key: &Pubkey,
    ) -> Result<MarketMetadata> {
        let market_account_data = (client.get_account_data(market_key))
            .await
            .map_err(|_| anyhow!("Failed to find market account"))?;
        let (header_bytes, bytes) = market_account_data.split_at(size_of::<MarketHeader>());
        let header = bytemuck::try_from_bytes::<MarketHeader>(header_bytes)
            .map_err(|_| anyhow!("Failed to deserialize market header"))?;
        let market = load_with_dispatch(&header.market_size_params, bytes)
            .map_err(|_| anyhow!("Market configuration not found"))?
            .inner;

        let base_mint_acct = spl_token::state::Mint::unpack(
            &client
                .get_account_data(&header.base_params.mint_key)
                .await
                .map_err(|_| anyhow!("Failed to find base mint account"))?,
        )
        .map_err(|_| anyhow!("Failed to deserialize base mint account"))?;
        let quote_mint_acct = spl_token::state::Mint::unpack(
            &client
                .get_account_data(&header.quote_params.mint_key)
                .await
                .map_err(|_| anyhow!("Failed to find quote mint account"))?,
        )
        .map_err(|_| anyhow!("Failed to deserialize quote mint account"))?;

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

        Ok(MarketMetadata {
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
        })
    }

    pub async fn parse_events_from_transaction(
        &self,
        market_key: &Pubkey,
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
        self.parse_phoenix_events(market_key, sig, event_list)
    }

    pub async fn parse_places(
        &self,
        market_key: &Pubkey,
        signature: &Signature,
    ) -> Vec<PhoenixEvent> {
        let events = self
            .parse_events_from_transaction(market_key, signature)
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

    pub async fn parse_cancels(
        &self,
        market_key: &Pubkey,
        signature: &Signature,
    ) -> Vec<PhoenixEvent> {
        let events = self
            .parse_events_from_transaction(market_key, signature)
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

    pub async fn parse_fills(
        &self,
        market_key: &Pubkey,
        signature: &Signature,
    ) -> Vec<PhoenixEvent> {
        let events = self
            .parse_events_from_transaction(market_key, signature)
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
        market_key: &Pubkey,
        signature: &Signature,
    ) -> (Vec<PhoenixEvent>, Vec<PhoenixEvent>) {
        let events = self
            .parse_events_from_transaction(market_key, signature)
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
        market_key: &Pubkey,
        price: u64,
        side: Side,
        size: u64,
    ) -> Option<(Signature, Vec<PhoenixEvent>)> {
        let new_order_ix = self.get_ioc_ix(market_key, price, side, size).ok()?;
        let signature = self
            .client
            .sign_send_instructions(vec![new_order_ix], vec![])
            .await
            .ok()?;
        let fills = self.parse_fills(market_key, &signature).await;
        Some((signature, fills))
    }

    pub async fn send_fok_buy(
        &self,
        market_key: &Pubkey,
        price: u64,
        size_in_quote_lots: u64,
    ) -> Option<(Signature, Vec<PhoenixEvent>)> {
        let new_order_ix = self
            .get_fok_buy_ix(market_key, price, size_in_quote_lots)
            .ok()?;

        let signature = self
            .client
            .sign_send_instructions(vec![new_order_ix], vec![])
            .await
            .ok()?;
        let fills = self.parse_fills(market_key, &signature).await;
        Some((signature, fills))
    }

    pub async fn send_fok_sell(
        &self,
        market_key: &Pubkey,
        price: u64,
        size_in_base_lots: u64,
    ) -> Option<(Signature, Vec<PhoenixEvent>)> {
        let new_order_ix = self
            .get_fok_sell_ix(market_key, price, size_in_base_lots)
            .ok()?;

        let signature = self
            .client
            .sign_send_instructions(vec![new_order_ix], vec![])
            .await
            .ok()?;
        let fills = self.parse_fills(market_key, &signature).await;
        Some((signature, fills))
    }

    pub async fn send_ioc_with_slippage(
        &self,
        market_key: &Pubkey,
        lots_in: u64,
        min_lots_out: u64,
        side: Side,
    ) -> Option<(Signature, Vec<PhoenixEvent>)> {
        let new_order_ix = self
            .get_ioc_with_slippage_ix(market_key, lots_in, min_lots_out, side)
            .ok()?;
        let signature = self
            .client
            .sign_send_instructions(vec![new_order_ix], vec![])
            .await
            .ok()?;
        let fills = self.parse_fills(market_key, &signature).await;
        Some((signature, fills))
    }

    pub async fn send_post_only(
        &self,
        market_key: &Pubkey,
        price: u64,
        side: Side,
        size: u64,
    ) -> Option<(Signature, Vec<PhoenixEvent>)> {
        let new_order_ix = self.get_post_only_ix(market_key, price, side, size).ok()?;
        let signature = self
            .client
            .sign_send_instructions(vec![new_order_ix], vec![])
            .await
            .ok()?;
        let fills = self.parse_fills(market_key, &signature).await;
        Some((signature, fills))
    }

    pub async fn send_limit_order(
        &self,
        market_key: &Pubkey,
        price: u64,
        side: Side,
        size: u64,
    ) -> Option<(Signature, Vec<PhoenixEvent>, Vec<PhoenixEvent>)> {
        let new_order_ix = self
            .get_limit_order_ix(market_key, price, side, size)
            .ok()?;
        let signature = self
            .client
            .sign_send_instructions(vec![new_order_ix], vec![])
            .await
            .ok()?;
        let (fills, places) = self.parse_fills_and_places(market_key, &signature).await;
        Some((signature, places, fills))
    }

    pub async fn send_cancel_ids(
        &self,
        market_key: &Pubkey,
        ids: Vec<FIFOOrderId>,
    ) -> Option<(Signature, Vec<PhoenixEvent>)> {
        let cancel_ix = self.get_cancel_ids_ix(market_key, ids).ok()?;
        let signature = self
            .client
            .sign_send_instructions(vec![cancel_ix], vec![])
            .await
            .ok()?;

        let cancels = self.parse_cancels(market_key, &signature).await;
        Some((signature, cancels))
    }

    pub async fn send_cancel_up_to(
        &self,
        market_key: &Pubkey,
        tick_limit: Option<u64>,
        side: Side,
    ) -> Option<(Signature, Vec<PhoenixEvent>)> {
        let cancel_ix = self
            .get_cancel_up_to_ix(market_key, tick_limit, side)
            .ok()?;
        let signature = self
            .client
            .sign_send_instructions(vec![cancel_ix], vec![])
            .await
            .ok()?;

        let cancels = self.parse_cancels(market_key, &signature).await;
        Some((signature, cancels))
    }

    pub async fn send_cancel_all(
        &self,
        market_key: &Pubkey,
    ) -> Option<(Signature, Vec<PhoenixEvent>)> {
        let cancel_all_ix = self.get_cancel_all_ix(market_key).ok()?;
        let signature = self
            .client
            .sign_send_instructions(vec![cancel_all_ix], vec![])
            .await
            .ok()?;

        let cancels = self.parse_cancels(market_key, &signature).await;
        Some((signature, cancels))
    }
}
