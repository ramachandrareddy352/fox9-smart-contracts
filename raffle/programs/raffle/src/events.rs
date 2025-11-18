use anchor_lang::prelude::*;

#[event]
#[derive(Debug)]
pub struct BuyEvent {
    pub raffle_id: u64,
    pub buyer: Pubkey,
    pub tickets: u64,
}

#[event]
pub struct WinnersEvent {
    pub raffle_id: u64,
    pub winners: Vec<Pubkey>,
}

#[event]
pub struct ClaimEvent {
    pub raffle_id: u64,
    pub winner: Pubkey,
    pub amount: u64,
}
