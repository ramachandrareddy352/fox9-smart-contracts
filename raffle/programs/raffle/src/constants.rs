pub(crate) use anchor_lang::prelude::*;

#[constant]
pub const FEE_MANTISSA: u16 = 10_000;
pub const TOTAL_PCT: u8 = 100; // sum of all percentages should be 100
pub const MINIMUM_TICKETS: u16 = 3; // minimum tickets have to set in a raffle
pub const MAXIMUM_TICKETS: u16 = 10_000; // maximum tickets can able to set is 10,000
pub const MAXIMUM_WALLET_PCT: u8 = 40; // maximum percentage of tickets can able to buy for a single buyer in a single raffle
pub const MAXIMUM_WINNERS_COUNT: u8 = 10; // maximum winners can be set in a raffle [1-10 max]
  
pub const CREATE_RAFFLE_PAUSE: u8 = 0;
pub const ACTIVATE_RAFFLE_PAUSE: u8 = 1;
pub const ANNOUNCE_WINNER_PAUSE: u8 = 2;
pub const BUY_TICKET_PAUSE: u8 = 3;
pub const BUYER_CLAIM_PRIZE_PAUSE: u8 = 4;
pub const CANCEL_RAFFLE_PAUSE: u8 = 5;
pub const CLAIM_AMOUNT_BACK_PAUSE: u8 = 6;
pub const UPDATE_RAFFLE_PAUSE: u8 = 7;
