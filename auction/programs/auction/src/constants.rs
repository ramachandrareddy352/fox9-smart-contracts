use anchor_lang::prelude::*;

#[constant]
pub const FEE_MANTISSA: u16 = 10_000; // basis for bps math (10000 -> 100.00%)

// PAUSE FUNCTION
pub const CREATE_AUCTION_PAUSE: u8 = 0;
pub const CANCEL_AUCTION_PAUSE: u8 = 1;
pub const COMPLETE_AUCTION_PAUSE: u8 = 2;
pub const PLACE_BID_PAUSE: u8 = 3;
pub const START_AUCTION_PAUSE: u8 = 4;
pub const UPDATE_AUCTION_PAUSE: u8 = 5;
