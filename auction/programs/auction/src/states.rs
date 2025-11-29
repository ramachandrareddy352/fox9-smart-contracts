use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct AuctionConfig {
    pub auction_owner: Pubkey,
    pub auction_admin: Pubkey,

    pub creation_fee_lamports: u64,
    pub commission_bps: u16,

    pub minimum_auction_period: u32,
    pub maximum_auction_period: u32,

    pub minimum_time_extension: u32,
    pub maximum_time_extension: u32,

    pub auction_count: u32,
    pub pause_flags: u8,

    pub config_bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Auction {
    pub auction_id: u32,
    pub creator: Pubkey,

    pub prize_mint: Pubkey,
    // check prize_escrow.owner == auction and prize_escrow.mint == prize_mint, while checking for prize escrow
    pub start_time: i64,
    pub end_time: i64,

    pub bid_mint: Option<Pubkey>, // None => SOL
    // check bid_escrow.owner == auction and bid_escrow.mint == bid_mint, while checking for bid escrow
    pub base_bid: u64,
    pub min_increment: u64, // min bidding increment
    pub time_extension: u32,

    pub highest_bid_amount: u64,
    pub highest_bidder: Pubkey,
    pub has_any_bid: bool,

    pub status: AuctionState,
    pub auction_bump: u8,
}

#[derive(InitSpace, AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum AuctionState {
    None,
    Initialized,
    Active,
    Cancelled, // when creator cancel the auction
    CompletedSuccessfully,
    CompletedFailed,
}
