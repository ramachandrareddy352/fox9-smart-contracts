pub(crate) use anchor_lang::prelude::*;

#[constant]
pub const FEE_MANTISSA: u16 = 10_000;
pub const MAX_PER_WALLET_PCT: u8 = 40; // default is 40%
pub const MAX_WINNERS_COUNT: u8 = 10; // maximum number of owners can be set in single raffle
pub const TOTAL_PCT: u8 = 100; // sum of all percentages should be 100

// State constants (instead of enum for gas: no deserialization overhead).
pub const RAFFLE_STATE_NONE: u8 = 0;
pub const RAFFLE_STATE_INITIALIZED: u8 = 1;
pub const RAFFLE_STATE_ACTIVE: u8 = 2;
pub const RAFFLE_STATE_CANCELLED: u8 = 3;
pub const RAFFLE_STATE_ENDED: u8 = 4;

// raffle winners prize type
pub const PRIZE_NFT: u8 = 0;
pub const PRIZE_SPL: u8 = 1;
pub const PRIZE_SOL: u8 = 2;
