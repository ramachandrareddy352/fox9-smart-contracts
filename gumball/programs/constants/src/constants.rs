pub(crate) use anchor_lang::prelude::*;

#[constant]
pub const FEE_MANTISSA: u16 = 10_000;

pub const MINIMUM_TICKETS: u16 = 3; // minimum tickets have to set in a GUMBALL
pub const MAXIMUM_TICKETS: u16 = 1_000; // number of prizes == number of tickets

pub const CREATE_GUMBALL_PAUSE: u8 = 0;
pub const ACTIVATE_GUMBALL_PAUSE: u8 = 1;
pub const ADD_PRIZE_IN_GUMBALL_PAUSE: u8 = 2;
pub const CANCEL_GUMBALL_PAUSE: u8 = 3;
pub const CLAIM_PRIZES_BACK_PAUSE: u8 = 4;
pub const END_GUMBALL_PAUSE: u8 = 5;
pub const SPIN_GUMBALL_PAUSE: u8 = 6;
pub const UPDATE_GUMBALL_PAUSE: u8 = 7;
