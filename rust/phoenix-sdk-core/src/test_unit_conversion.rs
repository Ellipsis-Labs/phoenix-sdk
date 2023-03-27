use std::collections::BTreeMap;

use phoenix::{program::MarketSizeParams, state::Side};
use solana_program::pubkey::Pubkey;

use crate::{
    market_event::Fill,
    sdk_client_core::{MarketMetadata, SDKClientCore},
};

fn setup(market: &Pubkey) -> SDKClientCore {
    let mut markets = BTreeMap::new();
    let meta = MarketMetadata {
        base_atoms_per_raw_base_unit: 1e9 as u64,
        quote_atoms_per_quote_unit: 1e6 as u64,
        base_atoms_per_base_lot: 10000000,
        num_base_lots_per_base_unit: 100,
        tick_size_in_quote_atoms_per_base_unit: 1000,
        quote_atoms_per_quote_lot: 10,
        raw_base_units_per_base_unit: 1,
        base_decimals: 9,
        quote_decimals: 6,
        base_mint: Pubkey::new_unique(),
        quote_mint: Pubkey::new_unique(),
        // Irrelevant for tests
        market_size_params: MarketSizeParams::default(),
    };
    assert_eq!(
        meta.base_atoms_per_raw_base_unit * meta.raw_base_units_per_base_unit as u64
            / meta.num_base_lots_per_base_unit,
        meta.base_atoms_per_base_lot
    );
    // This invariant must be true in order to ensure 0 rounding errors
    assert_eq!(
        meta.tick_size_in_quote_atoms_per_base_unit / meta.quote_atoms_per_quote_lot
            % meta.num_base_lots_per_base_unit,
        0,
    );
    markets.insert(*market, meta);

    SDKClientCore {
        markets,
        trader: Pubkey::new_unique(),
    }
}

fn setup_with_raw_base_unit_multiplier(
    market: &Pubkey,
    raw_base_units_per_base_unit: u32,
) -> SDKClientCore {
    let mut markets = BTreeMap::new();
    let meta = MarketMetadata {
        base_atoms_per_raw_base_unit: 1e9 as u64,
        quote_atoms_per_quote_unit: 1e6 as u64,
        base_atoms_per_base_lot: 10000000,
        // Both of these fields are multiplied by raw_base_units_per_base_unit
        num_base_lots_per_base_unit: 100 * raw_base_units_per_base_unit as u64,
        tick_size_in_quote_atoms_per_base_unit: 1000 * raw_base_units_per_base_unit as u64,
        quote_atoms_per_quote_lot: 10,
        raw_base_units_per_base_unit,
        base_decimals: 9,
        quote_decimals: 6,
        base_mint: Pubkey::new_unique(),
        quote_mint: Pubkey::new_unique(),
        // Irrelevant for tests
        market_size_params: MarketSizeParams::default(),
    };
    assert_eq!(
        meta.base_atoms_per_raw_base_unit * meta.raw_base_units_per_base_unit as u64
            / meta.num_base_lots_per_base_unit,
        meta.base_atoms_per_base_lot
    );
    // This invariant must be true in order to ensure 0 rounding errors
    assert_eq!(
        meta.tick_size_in_quote_atoms_per_base_unit / meta.quote_atoms_per_quote_lot
            % meta.num_base_lots_per_base_unit,
        0,
    );
    markets.insert(*market, meta);

    SDKClientCore {
        markets,
        trader: Pubkey::new_unique(),
    }
}

#[test]
fn test_raw_base_units_to_base_lots_rounded_down() {
    let market = Pubkey::new_unique();
    let core = setup(&market);
    let raw_base_units = 1.0001_f64;
    let base_lots = core
        .raw_base_units_to_base_lots_rounded_down(&market, raw_base_units)
        .unwrap();
    let meta = core.markets.get(&market).unwrap();
    assert_eq!(base_lots, meta.num_base_lots_per_base_unit);
}

#[test]
fn test_raw_base_units_to_base_lots_rounded_up() {
    let market = Pubkey::new_unique();
    let core = setup(&market);
    let raw_base_units = 1.001_f64;
    let base_lots = core
        .raw_base_units_to_base_lots_rounded_up(&market, raw_base_units)
        .unwrap();
    let meta = core.markets.get(&market).unwrap();
    assert_eq!(base_lots, meta.num_base_lots_per_base_unit + 1);
}

#[test]
fn test_base_atoms_to_base_lots_rounded_down() {
    let market = Pubkey::new_unique();
    let core = setup(&market);
    let base_atoms = 10000001;
    let base_lots = core
        .base_atoms_to_base_lots_rounded_down(&market, base_atoms)
        .unwrap();
    assert_eq!(base_lots, 1);
    let base_atoms = 10000000;
    let base_lots = core
        .base_atoms_to_base_lots_rounded_down(&market, base_atoms)
        .unwrap();
    assert_eq!(base_lots, 1);
}

#[test]
fn test_base_atoms_to_base_lots_rounded_up() {
    let market = Pubkey::new_unique();
    let core = setup(&market);
    let base_atoms = 10000001;
    let base_lots = core
        .base_atoms_to_base_lots_rounded_up(&market, base_atoms)
        .unwrap();
    assert_eq!(base_lots, 2);
    let base_atoms = 10000000;
    let base_lots = core
        .base_atoms_to_base_lots_rounded_up(&market, base_atoms)
        .unwrap();
    assert_eq!(base_lots, 1);
}

#[test]
fn test_base_lots_to_base_atoms() {
    let market = Pubkey::new_unique();
    let core = setup(&market);
    let base_lots = 1;
    let base_atoms = core.base_lots_to_base_atoms(&market, base_lots).unwrap();
    assert_eq!(base_atoms, 10000000);
}

#[test]
fn test_quote_units_to_quote_lots() {
    let market = Pubkey::new_unique();
    let core = setup(&market);
    let quote_units = 1.0001_f64;
    let quote_lots = core
        .quote_units_to_quote_lots(&market, quote_units)
        .unwrap();
    assert_eq!(quote_lots, 100000 + 10);
}

#[test]
fn test_quote_atoms_to_quote_lots_rounded_down() {
    let market = Pubkey::new_unique();
    let core = setup(&market);
    let quote_atoms = 1;
    let quote_lots = core
        .quote_atoms_to_quote_lots_rounded_down(&market, quote_atoms)
        .unwrap();
    assert_eq!(quote_lots, 0);
    let quote_atoms = 10;
    let quote_lots = core
        .quote_atoms_to_quote_lots_rounded_down(&market, quote_atoms)
        .unwrap();
    assert_eq!(quote_lots, 1);
}

#[test]
fn test_quote_atoms_to_quote_lots_rounded_up() {
    let market = Pubkey::new_unique();
    let core = setup(&market);
    let quote_atoms = 1;
    let quote_lots = core
        .quote_atoms_to_quote_lots_rounded_up(&market, quote_atoms)
        .unwrap();
    assert_eq!(quote_lots, 1);
    let quote_atoms = 10;
    let quote_lots = core
        .quote_atoms_to_quote_lots_rounded_up(&market, quote_atoms)
        .unwrap();
    assert_eq!(quote_lots, 1);
}

#[test]
fn test_quote_lots_to_quote_atoms() {
    let market = Pubkey::new_unique();
    let core = setup(&market);
    let quote_lots = 1;
    let quote_atoms = core.quote_lots_to_quote_atoms(&market, quote_lots).unwrap();
    assert_eq!(quote_atoms, 10);
}

#[test]
fn test_base_atoms_to_raw_base_units_as_float() {
    let market = Pubkey::new_unique();
    let core = setup(&market);
    let base_atoms = 1000000;
    let raw_base_unit = core
        .base_atoms_to_raw_base_units_as_float(&market, base_atoms)
        .unwrap();
    assert_eq!(raw_base_unit, 0.001);

    // Raw base unit multiplier should not affect the result.
    let core = setup_with_raw_base_unit_multiplier(&market, 1000);
    let base_atoms = 1000000;
    let raw_base_unit = core
        .base_atoms_to_raw_base_units_as_float(&market, base_atoms)
        .unwrap();
    assert_eq!(raw_base_unit, 0.001);
}

#[test]
fn test_quote_atoms_to_quote_units_as_float() {
    let market = Pubkey::new_unique();
    let core = setup(&market);
    let quote_atoms = 1000;
    let quote_unit = core
        .quote_atoms_to_quote_units_as_float(&market, quote_atoms)
        .unwrap();
    assert_eq!(quote_unit, 0.001);
}

#[test]
fn test_float_price_to_ticks_rounded_down() {
    let market = Pubkey::new_unique();
    let core = setup(&market);
    let float_price = 10.9071234;
    let ticks = core
        .float_price_to_ticks_rounded_down(&market, float_price)
        .unwrap();
    assert_eq!(ticks, 10907);
    let float_price = 0.00099;
    let ticks = core
        .float_price_to_ticks_rounded_down(&market, float_price)
        .unwrap();
    assert_eq!(ticks, 0);

    // Raw base unit multiplier will not affect the result if the tick size and base lots per base unit are adjusted accordingly.
    let core = setup_with_raw_base_unit_multiplier(&market, 100);
    let float_price = 10.9071234;
    let ticks = core
        .float_price_to_ticks_rounded_down(&market, float_price)
        .unwrap();
    assert_eq!(ticks, 10907);
    let float_price = 0.00099;
    let ticks = core
        .float_price_to_ticks_rounded_down(&market, float_price)
        .unwrap();
    assert_eq!(ticks, 0);
}

#[test]
fn test_float_price_to_ticks_rounded_up() {
    let market = Pubkey::new_unique();
    let core = setup(&market);
    let float_price = 10.9071234;
    let ticks = core
        .float_price_to_ticks_rounded_up(&market, float_price)
        .unwrap();
    assert_eq!(ticks, 10908);
    let float_price = 0.0009999999999999999;
    let ticks = core
        .float_price_to_ticks_rounded_up(&market, float_price)
        .unwrap();
    assert_eq!(ticks, 1);

    // Raw base unit multiplier will not affect the result if the tick size and base lots per base unit are adjusted accordingly.
    let core = setup_with_raw_base_unit_multiplier(&market, 100);
    let float_price = 10.9071234;
    let ticks = core
        .float_price_to_ticks_rounded_up(&market, float_price)
        .unwrap();
    assert_eq!(ticks, 10908);
    let float_price = 0.00099;
    let ticks = core
        .float_price_to_ticks_rounded_up(&market, float_price)
        .unwrap();
    assert_eq!(ticks, 1);
}

#[test]
fn test_ticks_to_float_price() {
    let market = Pubkey::new_unique();
    let core = setup(&market);
    let ticks = 10907;
    let float_price = core.ticks_to_float_price(&market, ticks).unwrap();
    assert_eq!(float_price, 10.907);

    // Raw base unit multiplier will not affect the result if the tick size and base lots per base unit are adjusted accordingly.
    let core = setup_with_raw_base_unit_multiplier(&market, 100);
    let ticks = 10907;
    let float_price = core.ticks_to_float_price(&market, ticks).unwrap();
    assert_eq!(float_price, 10.907);
}

#[test]
fn test_fill_event_to_quote_atoms() {
    let market = Pubkey::new_unique();
    let core = setup(&market);
    let fill_event = Fill {
        price_in_ticks: 10907,
        base_lots_filled: 1000000,
        base_lots_remaining: 0,
        maker: Pubkey::new_unique(),
        taker: Pubkey::new_unique(),
        order_sequence_number: 12345,
        side_filled: Side::Ask,
        is_full_fill: true,
    };
    let quote_atoms = core
        .fill_event_to_quote_atoms(&market, &fill_event)
        .unwrap();
    assert_eq!(
        quote_atoms,
        core.base_lots_and_price_to_quote_atoms(
            &market,
            fill_event.base_lots_filled,
            fill_event.price_in_ticks
        )
        .unwrap()
    );
}

#[test]
fn test_base_lots_and_price_to_quote_atoms() {
    let market = Pubkey::new_unique();
    let core = setup(&market);
    let base_lots = 1000000;
    let price_in_ticks = 10907;
    let quote_atoms = core
        .base_lots_and_price_to_quote_atoms(&market, base_lots, price_in_ticks)
        .unwrap();
    let meta = core.get_market_metadata(&market);

    assert_eq!(
        quote_atoms,
        base_lots * price_in_ticks * meta.quote_atoms_per_quote_lot // tick_size_in_quote_lots_per_base_unit == base_lots_per_base_unit
    );

    let core = setup_with_raw_base_unit_multiplier(&market, 100);
    let base_lots = 1000000;
    let price_in_ticks = 10907;
    let quote_atoms = core
        .base_lots_and_price_to_quote_atoms(&market, base_lots, price_in_ticks)
        .unwrap();
    let meta = core.get_market_metadata(&market);

    assert_eq!(
        quote_atoms,
        base_lots * price_in_ticks * meta.quote_atoms_per_quote_lot // tick_size_in_quote_lots_per_base_unit == base_lots_per_base_unit
    );
}
