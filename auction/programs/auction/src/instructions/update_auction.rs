use anchor_lang::prelude::*;
use crate::constants::UPDATE_AUCTION_PAUSE;
use crate::errors::{AuctionStateErrors, ConfigStateErrors};
use crate::states::*;
use crate::utils::is_paused;

#[event]
pub struct AuctionUpdated {
    pub auction_id: u32,
    pub start_time: i64,
    pub end_time: i64,
    pub base_bid: u64,
    pub min_increment: u64,
    pub time_extension: u32,
    pub updated_at: i64,
}

pub fn update_auction(
    ctx: Context<UpdateAuction>,
    _auction_id: u32,
    mut start_time: i64,
    end_time: i64,
    start_immediately: bool, // If true, set start_time = now (but we still require status==Initialized & no bids)
    base_bid: u64,
    min_increment: u64,
    time_extension: u32,
) -> Result<()> {
    let auction = &mut ctx.accounts.auction;
    let config = &ctx.accounts.auction_config;
    let now = Clock::get()?.unix_timestamp;

    // Check if update function is paused
    require!(
        !is_paused(config.pause_flags, UPDATE_AUCTION_PAUSE),
        AuctionStateErrors::FunctionPaused
    );

    // Auction must be in Initialized state
    require!(
        auction.status == AuctionState::Initialized,
        AuctionStateErrors::AuctionNotActive
    );

    // Auction must not have started yet (current time before existing start_time)
    require_gt!(
        auction.start_time,
        now,
        AuctionStateErrors::AuctionAlreadyStarted
    );

    // No bids must be present to allow update
    require!(!auction.has_any_bid, AuctionStateErrors::AuctionHasBids);

    // If start_immediately asked, set start_time to now
    if start_immediately {
        start_time = now;
    }

    // Ensure provided start_time is not in the past
    require_gte!(start_time, now, AuctionStateErrors::StartTimeInPast);

    // duration checks (end_time must be >= start_time)
    let duration = end_time
        .checked_sub(start_time)
        .ok_or(AuctionStateErrors::StartTimeExceedEndTime)?;

    require!(
        duration >= config.minimum_auction_period as i64
            && duration <= config.maximum_auction_period as i64,
        ConfigStateErrors::InvalidAuctionPeriod
    );
    require!(
        time_extension >= config.minimum_time_extension
            && time_extension <= config.maximum_time_extension,
        ConfigStateErrors::InvalidTimeExtension
    );

    // min_increment must be > 0
    require_gt!(min_increment, 0, AuctionStateErrors::InvalidZeroAmount);

    // Apply updates
    auction.start_time = start_time;
    auction.end_time = end_time;
    auction.base_bid = base_bid;
    auction.min_increment = min_increment;
    auction.time_extension = time_extension;
    // highest_bid_amount should reflect base_bid after update (since there are no bids)
    auction.highest_bid_amount = base_bid;

    emit!(AuctionUpdated {
        auction_id: auction.auction_id,
        start_time: auction.start_time,
        end_time: auction.end_time,
        base_bid: auction.base_bid,
        min_increment: auction.min_increment,
        time_extension: auction.time_extension,
        updated_at: now,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(auction_id: u32)]
pub struct UpdateAuction<'info> {
    #[account(
        seeds = [b"auction"],
        bump = auction_config.config_bump,
        constraint = auction_config.auction_admin == auction_admin.key() @ ConfigStateErrors::InvalidAuctionAdmin
    )]
    pub auction_config: Box<Account<'info, AuctionConfig>>,

    #[account(
        mut,
        seeds = [b"auction", auction_id.to_le_bytes().as_ref()],
        bump = auction.auction_bump,
        constraint = auction.auction_id == auction_id @ AuctionStateErrors::InvalidAuctionId,
    )]
    pub auction: Box<Account<'info, Auction>>,

    //the caller who wants to update. Must be either auction.creator
    #[account(
        mut,
        constraint = auction.creator == creator.key() @ AuctionStateErrors::InvalidCreator
    )]
    pub creator: Signer<'info>,

    pub auction_admin: Signer<'info>,
}
