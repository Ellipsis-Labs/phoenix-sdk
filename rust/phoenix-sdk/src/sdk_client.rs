use crate::order_packet_template::ImmediateOrCancelOrderTemplate;
use crate::order_packet_template::LimitOrderTemplate;
use crate::order_packet_template::PostOnlyOrderTemplate;
use crate::utils::create_ata_ix_if_needed;
use crate::utils::create_claim_seat_ix_if_needed;
use anyhow::anyhow;
use anyhow::Result;
use ellipsis_client::EllipsisClient;
use phoenix::program::create_new_order_instruction;
use phoenix::program::dispatch_market::*;
use phoenix::program::EvictEvent;
use phoenix::program::ExpiredOrderEvent;
use phoenix::program::FeeEvent;
use phoenix::program::FillEvent;
use phoenix::program::FillSummaryEvent;
use phoenix::program::MarketHeader;
use phoenix::program::PhoenixMarketEvent;
use phoenix::program::PlaceEvent;
use phoenix::program::ReduceEvent;
use phoenix::program::TimeInForceEvent;
use phoenix::quantities::BaseLots;
use phoenix::quantities::QuoteLots;
use phoenix::quantities::Ticks;
use phoenix::quantities::WrapperU64;
use phoenix::state::enums::*;
use phoenix::state::markets::*;
use phoenix::state::OrderPacket;
use phoenix::state::TraderState;
use phoenix_sdk_core::market_event::TimeInForce;
use phoenix_sdk_core::sdk_client_core::MarketState;
use phoenix_sdk_core::sdk_client_core::RawPhoenixEvent;
pub use phoenix_sdk_core::{
    market_event::{Evict, Fill, FillSummary, MarketEventDetails, PhoenixEvent, Place, Reduce},
    sdk_client_core::{get_decimal_string, MarketMetadata, PhoenixOrder, SDKClientCore},
};
use serde::{Deserialize, Serialize};
use solana_client::client_error::reqwest;
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_program::instruction::Instruction;
use solana_sdk::{
    commitment_config::CommitmentConfig,
    pubkey::Pubkey,
    signature::{Signature, Signer},
    signer::keypair::Keypair,
};
use std::collections::HashMap;
use std::ops::Deref;
use std::str::FromStr;
use std::{collections::BTreeMap, mem::size_of, ops::DerefMut};

use crate::orderbook::Orderbook;

#[derive(Debug, Serialize, Deserialize)]
pub struct JsonMarketConfig {
    pub markets: Vec<MarketInfoConfig>,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct MarketInfoConfig {
    pub market: String,
    pub baseMint: String,
    pub quoteMint: String,
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

/// Constuctor functions that create a new SDKClient
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
        println!("Added all markets");
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
        let core = SDKClientCore {
            markets: BTreeMap::new(),
            trader: client.payer.pubkey(),
        };
        let mut sdk = SDKClient { client, core };
        for market_key in market_keys {
            sdk.add_market(market_key).await?;
        }
        Ok(sdk)
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
}

/// Mutable functions that modify the internal state of the SDKClient
impl SDKClient {
    /// Load in all known markets from a pre-defined config file located in the SDK github.
    pub async fn add_all_markets(&mut self) -> Result<()> {
        let config_url =
            "https://raw.githubusercontent.com/Ellipsis-Labs/phoenix-sdk/master/master_config.json";

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

        let market_details = response
            .get(cluster)
            .ok_or_else(|| anyhow!("Failed to find cluster {} in config file", cluster))?;

        for market in market_details.markets.iter() {
            let market_key = Pubkey::from_str(&market.market).map_err(|e| anyhow!(e))?;
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

    /// This function adds the metadata for a market to the SDKClient's market cache.
    pub async fn add_market(&mut self, market_key: &Pubkey) -> anyhow::Result<()> {
        let market_metadata = self.get_market_metadata(market_key).await?;
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
}

/// Getter functions that make asynchronous calls via a Solana RPC connection to fetch state and events from Phoenix.
impl SDKClient {
    pub async fn get_market_metadata(&self, market_key: &Pubkey) -> Result<MarketMetadata> {
        match self.markets.get(market_key) {
            Some(metadata) => Ok(*metadata),
            None => {
                let market_account_data = (self.client.get_account_data(market_key))
                    .await
                    .map_err(|_| anyhow!("Failed to find market account"))?;
                self.get_market_metadata_from_header_bytes(
                    &market_account_data[..size_of::<MarketHeader>()],
                )
            }
        }
    }

    fn get_market_metadata_from_header_bytes(&self, header_bytes: &[u8]) -> Result<MarketMetadata> {
        bytemuck::try_from_bytes(header_bytes)
            .map_err(|_| anyhow!("Failed to deserialize market header"))
            .and_then(MarketMetadata::from_header)
    }

    /// Fetches a market's metadata from the SDKClient's market cache. This cache must be
    /// explicitly populated by calling `add_market` or `add_all_markets`.
    ///
    /// Because the market metadata is static, it is recommended to call `add_market` and
    /// use this function when repeatedly looking up metadata to avoid making
    /// additional RPC calls.
    pub fn get_market_metadata_from_cache(
        &self,
        market_key: &Pubkey,
    ) -> anyhow::Result<&MarketMetadata> {
        match self.markets.get(market_key) {
            Some(metadata) => Ok(metadata),
            None => Err(anyhow!(
                "Market metadata not found in cache. Try calling add_market first."
            )),
        }
    }

    pub async fn get_market_ladder(&self, market_key: &Pubkey, levels: u64) -> Result<Ladder> {
        let market_account_data = (self.client.get_account_data(market_key))
            .await
            .map_err(|_| anyhow!("Failed to get market account data"))?;
        let (header_bytes, bytes) = market_account_data.split_at(size_of::<MarketHeader>());
        let meta = self.get_market_metadata_from_header_bytes(header_bytes)?;
        let market = load_with_dispatch(&meta.market_size_params, bytes)
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
        let default_orderbook = Orderbook::<FIFOOrderId, PhoenixOrder> {
            raw_base_units_per_base_lot: 0.0,
            quote_units_per_raw_base_unit_per_tick: 0.0,
            bids: BTreeMap::new(),
            asks: BTreeMap::new(),
        };
        if market_account_data.is_empty() {
            return Ok(default_orderbook);
        }
        let (header_bytes, bytes) = market_account_data.split_at(size_of::<MarketHeader>());
        let meta = self.get_market_metadata_from_header_bytes(header_bytes)?;
        let raw_base_units_per_base_lot = meta.raw_base_units_per_base_lot();
        let quote_units_per_raw_base_unit_per_tick = meta.quote_units_per_raw_base_unit_per_tick();
        Ok(load_with_dispatch(&meta.market_size_params, bytes)
            .map(|market| {
                Orderbook::from_market(
                    market.inner,
                    raw_base_units_per_base_lot,
                    quote_units_per_raw_base_unit_per_tick,
                )
            })
            .unwrap_or_else(|_| default_orderbook.clone()))
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
        let meta = self.get_market_metadata_from_header_bytes(header_bytes)?;
        let market = load_with_dispatch(&meta.market_size_params, bytes)
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
                        raw_base_units_per_base_lot: 0.0,
                        quote_units_per_raw_base_unit_per_tick: 0.0,
                        bids: BTreeMap::new(),
                        asks: BTreeMap::new(),
                    },
                    traders: BTreeMap::new(),
                })
            }
        };
        let (header_bytes, bytes) = market_account_data.split_at(size_of::<MarketHeader>());
        let meta = self.get_market_metadata_from_header_bytes(header_bytes)?;
        let market = load_with_dispatch(&meta.market_size_params, bytes)
            .map_err(|_| anyhow!("Market configuration not found"))?
            .inner;
        let orderbook = Orderbook::from_market(
            market,
            meta.raw_base_units_per_base_lot(),
            meta.quote_units_per_raw_base_unit_per_tick(),
        );

        let traders = market
            .get_registered_traders()
            .iter()
            .map(|(k, v)| (*k, *v))
            .collect();

        Ok(MarketState { orderbook, traders })
    }

    pub async fn parse_raw_phoenix_events(
        &self,
        raw_phoenix_events: Vec<RawPhoenixEvent>,
    ) -> Option<Vec<PhoenixEvent>> {
        let mut trade_direction = None;
        let mut market_events = vec![];
        let mut cached_metadata = self.markets.clone();
        for raw_phoenix_event in raw_phoenix_events {
            let header = raw_phoenix_event.header;
            if let std::collections::btree_map::Entry::Vacant(e) =
                cached_metadata.entry(header.market)
            {
                let metadata = self.get_market_metadata(&header.market).await.ok()?;
                e.insert(metadata);
            }
            let meta = cached_metadata.get(&header.market)?;

            for phoenix_event in raw_phoenix_event.batch {
                match phoenix_event {
                    PhoenixMarketEvent::Fill(FillEvent {
                        index,
                        maker_id,
                        order_sequence_number,
                        price_in_ticks,
                        base_lots_filled,
                        base_lots_remaining,
                    }) => {
                        let side_filled = Side::from_order_sequence_number(order_sequence_number);
                        market_events.push(PhoenixEvent {
                            market: header.market,
                            sequence_number: header.sequence_number,
                            slot: header.slot,
                            timestamp: header.timestamp,
                            signature: header.signature,
                            signer: header.signer,
                            event_index: index as u64,
                            details: MarketEventDetails::Fill(Fill {
                                order_sequence_number,
                                maker: maker_id,
                                taker: header.signer,
                                price_in_ticks,
                                base_lots_filled,
                                base_lots_remaining,
                                side_filled: Side::from_order_sequence_number(
                                    order_sequence_number,
                                ),
                                is_full_fill: base_lots_remaining == 0,
                            }),
                        });
                        if trade_direction.is_none() {
                            trade_direction = match side_filled {
                                Side::Bid => Some(-1),
                                Side::Ask => Some(1),
                            }
                        }
                    }
                    PhoenixMarketEvent::Reduce(ReduceEvent {
                        index,
                        order_sequence_number,
                        price_in_ticks,
                        base_lots_removed,
                        base_lots_remaining,
                    }) => market_events.push(PhoenixEvent {
                        market: header.market,
                        sequence_number: header.sequence_number,
                        slot: header.slot,
                        timestamp: header.timestamp,
                        signature: header.signature,
                        signer: header.signer,
                        event_index: index as u64,
                        details: MarketEventDetails::Reduce(Reduce {
                            order_sequence_number,
                            maker: header.signer,
                            price_in_ticks,
                            base_lots_removed,
                            base_lots_remaining,
                            is_full_cancel: base_lots_remaining == 0,
                        }),
                    }),

                    PhoenixMarketEvent::Place(PlaceEvent {
                        index,
                        order_sequence_number,
                        client_order_id,
                        price_in_ticks,
                        base_lots_placed,
                    }) => market_events.push(PhoenixEvent {
                        market: header.market,
                        sequence_number: header.sequence_number,
                        slot: header.slot,
                        timestamp: header.timestamp,
                        signature: header.signature,
                        signer: header.signer,
                        event_index: index as u64,
                        details: MarketEventDetails::Place(Place {
                            order_sequence_number,
                            client_order_id,
                            maker: header.signer,
                            price_in_ticks,
                            base_lots_placed,
                        }),
                    }),
                    PhoenixMarketEvent::Evict(EvictEvent {
                        index,
                        maker_id,
                        order_sequence_number,
                        price_in_ticks,
                        base_lots_evicted,
                    }) => market_events.push(PhoenixEvent {
                        market: header.market,
                        sequence_number: header.sequence_number,
                        slot: header.slot,
                        timestamp: header.timestamp,
                        signature: header.signature,
                        signer: header.signer,
                        event_index: index as u64,
                        details: MarketEventDetails::Evict(Evict {
                            order_sequence_number,
                            maker: maker_id,
                            price_in_ticks,
                            base_lots_evicted,
                        }),
                    }),
                    PhoenixMarketEvent::FillSummary(FillSummaryEvent {
                        index,
                        client_order_id,
                        total_base_lots_filled,
                        total_quote_lots_filled,
                        total_fee_in_quote_lots,
                    }) => {
                        market_events.push(PhoenixEvent {
                            market: header.market,
                            sequence_number: header.sequence_number,
                            slot: header.slot,
                            timestamp: header.timestamp,
                            signature: header.signature,
                            signer: header.signer,
                            event_index: index as u64,
                            details: MarketEventDetails::FillSummary(FillSummary {
                                client_order_id,
                                total_base_filled: total_base_lots_filled
                                    * meta.base_atoms_per_base_lot,
                                total_quote_filled_including_fees: total_quote_lots_filled
                                    * meta.quote_atoms_per_quote_lot,
                                total_quote_fees: total_fee_in_quote_lots
                                    * meta.quote_atoms_per_quote_lot,
                                trade_direction: trade_direction.unwrap_or(0),
                            }),
                        });
                        trade_direction = None;
                    }
                    PhoenixMarketEvent::Fee(FeeEvent {
                        index,
                        fees_collected_in_quote_lots,
                    }) => market_events.push(PhoenixEvent {
                        market: header.market,
                        sequence_number: header.sequence_number,
                        slot: header.slot,
                        timestamp: header.timestamp,
                        signature: header.signature,
                        signer: header.signer,
                        event_index: index as u64,
                        details: MarketEventDetails::Fee(
                            fees_collected_in_quote_lots * meta.quote_atoms_per_quote_lot,
                        ),
                    }),
                    PhoenixMarketEvent::TimeInForce(TimeInForceEvent {
                        index,
                        order_sequence_number,
                        last_valid_slot,
                        last_valid_unix_timestamp_in_seconds,
                    }) => market_events.push(PhoenixEvent {
                        market: header.market,
                        sequence_number: header.sequence_number,
                        slot: header.slot,
                        timestamp: header.timestamp,
                        signature: header.signature,
                        signer: header.signer,
                        event_index: index as u64,
                        details: MarketEventDetails::TimeInForce(TimeInForce {
                            order_sequence_number,
                            last_valid_slot,
                            last_valid_unix_timestamp_in_seconds,
                        }),
                    }),
                    PhoenixMarketEvent::ExpiredOrder(ExpiredOrderEvent {
                        index,
                        maker_id,
                        order_sequence_number,
                        price_in_ticks,
                        base_lots_removed,
                    }) => market_events.push(PhoenixEvent {
                        market: header.market,
                        sequence_number: header.sequence_number,
                        slot: header.slot,
                        timestamp: header.timestamp,
                        signature: header.signature,
                        signer: header.signer,
                        event_index: index as u64,
                        details: MarketEventDetails::Reduce(Reduce {
                            order_sequence_number,
                            maker: maker_id,
                            price_in_ticks,
                            base_lots_removed,
                            base_lots_remaining: 0,
                            is_full_cancel: true,
                        }),
                    }),
                    _ => {
                        println!("Unknown event: {:?}", phoenix_event);
                    }
                }
            }
        }
        Some(market_events)
    }

    pub async fn parse_events_from_transaction(
        &self,
        sig: &Signature,
    ) -> Option<Vec<PhoenixEvent>> {
        let tx = self.client.get_transaction(sig).await.ok()?;
        if tx.is_err {
            return None;
        }
        let events = self.core.parse_events_from_transaction(&tx)?;
        self.parse_raw_phoenix_events(events).await
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
}

/// Functions for sending transactions that interact with the Phoenix program
impl SDKClient {
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
        let fills = self.parse_fills(&signature).await;
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
        let fills = self.parse_fills(&signature).await;
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
        let fills = self.parse_fills(&signature).await;
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
        let fills = self.parse_fills(&signature).await;
        Some((signature, fills))
    }

    pub async fn send_post_only(
        &self,
        market_key: &Pubkey,
        price: u64,
        side: Side,
        size: u64,
    ) -> Option<(Signature, Vec<PhoenixEvent>)> {
        let new_order_ixs = self
            .get_post_only_new_maker_ixs(market_key, price, side, size)
            .await
            .ok()?;
        let signature = self
            .client
            .sign_send_instructions(new_order_ixs, vec![])
            .await
            .ok()?;
        let fills = self.parse_fills(&signature).await;
        Some((signature, fills))
    }

    pub async fn send_limit_order(
        &self,
        market_key: &Pubkey,
        price: u64,
        side: Side,
        size: u64,
    ) -> Option<(Signature, Vec<PhoenixEvent>, Vec<PhoenixEvent>)> {
        let new_order_ixs = self
            .get_limit_order_new_maker_ixs(market_key, price, side, size)
            .await
            .ok()?;
        let signature = self
            .client
            .sign_send_instructions(new_order_ixs, vec![])
            .await
            .ok()?;
        let (fills, places) = self.parse_fills_and_places(&signature).await;
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

        let cancels = self.parse_cancels(&signature).await;
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

        let cancels = self.parse_cancels(&signature).await;
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

        let cancels = self.parse_cancels(&signature).await;
        Some((signature, cancels))
    }

    /// Returns the instructions needed to set up a maker account for a market. Includes:
    /// - Creation of associated token accounts for base and quote tokens, if needed.
    /// - Claiming of the market's seat, if needed.
    /// - Evicting a seat on the market if the market trader state is full.
    pub async fn get_maker_setup_instructions_for_market(
        &self,
        market_key: &Pubkey,
    ) -> anyhow::Result<Vec<Instruction>> {
        let metadata = self.get_market_metadata(market_key).await?;
        let mut instructions = Vec::with_capacity(4);
        instructions.extend_from_slice(
            &create_ata_ix_if_needed(
                &self.client,
                &self.trader,
                &self.trader,
                &metadata.base_mint,
            )
            .await,
        );

        instructions.extend_from_slice(
            &create_ata_ix_if_needed(
                &self.client,
                &self.trader,
                &self.trader,
                &metadata.quote_mint,
            )
            .await,
        );

        instructions.extend_from_slice(
            &create_claim_seat_ix_if_needed(&self.client, market_key, &self.trader).await?,
        );

        Ok(instructions)
    }

    // Useful if unsure trader has an ATA for the base or quote or has a seat on the market
    pub async fn get_limit_order_new_maker_ixs(
        &self,
        market_key: &Pubkey,
        price: u64,
        side: Side,
        size: u64,
    ) -> anyhow::Result<Vec<Instruction>> {
        let mut instructions = Vec::with_capacity(5);
        instructions.extend_from_slice(
            &self
                .get_maker_setup_instructions_for_market(market_key)
                .await?,
        );

        let limit_order_ix = self.get_limit_order_ix(market_key, price, side, size)?;

        instructions.push(limit_order_ix);
        Ok(instructions)
    }

    // Useful if unsure trader has an ATA for the base or quote or has a seat on the market
    pub async fn get_post_only_new_maker_ixs(
        &self,
        market_key: &Pubkey,
        price: u64,
        side: Side,
        size: u64,
    ) -> Result<Vec<Instruction>> {
        let mut instructions = Vec::with_capacity(5);
        instructions.extend_from_slice(
            &self
                .get_maker_setup_instructions_for_market(market_key)
                .await?,
        );
        let post_only_ix = self.get_post_only_ix(market_key, price, side, size)?;

        instructions.push(post_only_ix);
        Ok(instructions)
    }

    // Create a limit order instruction from a LimitOrderTemplate
    pub fn get_limit_order_ix_from_template(
        &self,
        market_key: &Pubkey,
        market_metadata: &MarketMetadata,
        limit_order_template: &LimitOrderTemplate,
    ) -> Result<Instruction> {
        let LimitOrderTemplate {
            side,
            price_as_float,
            size_in_base_units,
            self_trade_behavior,
            match_limit,
            client_order_id,
            use_only_deposited_funds,
            last_valid_slot,
            last_valid_unix_timestamp_in_seconds,
            fail_silently_on_insufficient_funds,
        } = limit_order_template;

        let price_in_ticks = self.float_price_to_ticks_rounded_down(market_key, *price_as_float)?;
        let size_in_num_base_lots =
            self.raw_base_units_to_base_lots_rounded_down(market_key, *size_in_base_units)?;

        let limit_order_packet = OrderPacket::Limit {
            side: *side,
            price_in_ticks: Ticks::new(price_in_ticks),
            num_base_lots: BaseLots::new(size_in_num_base_lots),
            self_trade_behavior: *self_trade_behavior,
            match_limit: *match_limit,
            client_order_id: *client_order_id,
            use_only_deposited_funds: *use_only_deposited_funds,
            last_valid_slot: *last_valid_slot,
            last_valid_unix_timestamp_in_seconds: *last_valid_unix_timestamp_in_seconds,
            fail_silently_on_insufficient_funds: *fail_silently_on_insufficient_funds,
        };

        let limit_order_ix = create_new_order_instruction(
            market_key,
            &self.get_trader(),
            &market_metadata.base_mint,
            &market_metadata.quote_mint,
            &limit_order_packet,
        );
        Ok(limit_order_ix)
    }

    // Create a post-only order instruction from a PostOnlyOrderTemplate
    pub fn get_post_only_ix_from_template(
        &self,
        market_key: &Pubkey,
        market_metadata: &MarketMetadata,
        post_only_order_template: &PostOnlyOrderTemplate,
    ) -> Result<Instruction> {
        let PostOnlyOrderTemplate {
            side,
            price_as_float,
            size_in_base_units,
            client_order_id,
            reject_post_only,
            use_only_deposited_funds,
            last_valid_slot,
            last_valid_unix_timestamp_in_seconds,
            fail_silently_on_insufficient_funds,
        } = post_only_order_template;

        let price_in_ticks = self.float_price_to_ticks_rounded_down(market_key, *price_as_float)?;
        let size_in_num_base_lots =
            self.raw_base_units_to_base_lots_rounded_down(market_key, *size_in_base_units)?;

        let post_only_packet = OrderPacket::PostOnly {
            side: *side,
            price_in_ticks: Ticks::new(price_in_ticks),
            num_base_lots: BaseLots::new(size_in_num_base_lots),
            client_order_id: *client_order_id,
            reject_post_only: *reject_post_only,
            use_only_deposited_funds: *use_only_deposited_funds,
            last_valid_slot: *last_valid_slot,
            last_valid_unix_timestamp_in_seconds: *last_valid_unix_timestamp_in_seconds,
            fail_silently_on_insufficient_funds: *fail_silently_on_insufficient_funds,
        };

        let post_only_ix = create_new_order_instruction(
            market_key,
            &self.get_trader(),
            &market_metadata.base_mint,
            &market_metadata.quote_mint,
            &post_only_packet,
        );

        Ok(post_only_ix)
    }

    // Create an immediate or cancel order instruction from a ImmediateOrCancelOrderTemplate
    pub fn get_ioc_ix_from_template(
        &self,
        market_key: &Pubkey,
        market_metadata: &MarketMetadata,
        ioc_order_template: &ImmediateOrCancelOrderTemplate,
    ) -> Result<Instruction> {
        let ImmediateOrCancelOrderTemplate {
            side,
            price_as_float: price_in_float,
            size_in_base_units,
            size_in_quote_units,
            min_base_units_to_fill,
            min_quote_units_to_fill,
            self_trade_behavior,
            match_limit,
            client_order_id,
            use_only_deposited_funds,
            last_valid_slot,
            last_valid_unix_timestamp_in_seconds,
        } = ioc_order_template;

        let price_in_ticks: Option<Ticks> = match price_in_float {
            Some(price_in_float) => {
                let price_in_ticks =
                    self.float_price_to_ticks_rounded_down(market_key, *price_in_float)?;
                Some(Ticks::new(price_in_ticks))
            }
            None => None,
        };

        let size_in_num_base_lots =
            self.raw_base_units_to_base_lots_rounded_down(market_key, *size_in_base_units)?;
        let size_in_num_quote_lots =
            self.quote_units_to_quote_lots(market_key, *size_in_quote_units)?;
        let min_base_lots_to_fill =
            self.raw_base_units_to_base_lots_rounded_down(market_key, *min_base_units_to_fill)?;
        let min_quote_lots_to_fill =
            self.quote_units_to_quote_lots(market_key, *min_quote_units_to_fill)?;

        let ioc_order_packet = OrderPacket::ImmediateOrCancel {
            side: *side,
            price_in_ticks,
            num_base_lots: BaseLots::new(size_in_num_base_lots),
            num_quote_lots: QuoteLots::new(size_in_num_quote_lots),
            min_base_lots_to_fill: BaseLots::new(min_base_lots_to_fill),
            min_quote_lots_to_fill: QuoteLots::new(min_quote_lots_to_fill),
            self_trade_behavior: *self_trade_behavior,
            match_limit: *match_limit,
            client_order_id: *client_order_id,
            use_only_deposited_funds: *use_only_deposited_funds,
            last_valid_slot: *last_valid_slot,
            last_valid_unix_timestamp_in_seconds: *last_valid_unix_timestamp_in_seconds,
        };

        let ioc_ix = create_new_order_instruction(
            market_key,
            &self.get_trader(),
            &market_metadata.base_mint,
            &market_metadata.quote_mint,
            &ioc_order_packet,
        );

        Ok(ioc_ix)
    }
}
