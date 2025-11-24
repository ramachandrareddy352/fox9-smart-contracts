pub(crate) use anchor_lang::prelude::*;

#[constant]
pub const FEE_MANTISSA: u16 = 10_000;
pub const TOTAL_PCT: u8 = 100; // sum of all percentages should be 100
pub const MINIMUM_TICKETS: u16 = 3; // minimum tickets have to set in a raffle
pub const MAXIMUM_TICKETS: u16 = 10_000; // maximum tickets can able to set is 10,000
pub const MAXIMUM_WALLET_PCT: u8 = 40; // maximum percentage of tickets can able to buy for a single buyer in a single raffle
pub const MAXIMUM_WINNERS_COUNT: u8 = 10; // maximum winners can be set in a raffle [1-10 max]
