use anchor_lang::prelude::*;
use crate::constants::START_AUCTION_PAUSE;
use crate::errors::{ConfigStateErrors, AuctionStateErrors};
use crate::states::*;
use crate::utils::is_paused;

#[event]
pub struct AuctionStarted {
    pub auction_id: u32,
    pub started_at: i64,
}

pub fn start_auction(ctx: Context<StartAuction>, _auction_id: u32) -> Result<()> {
    let auction = &mut ctx.accounts.auction;

    require!(
        !is_paused(ctx.accounts.auction_config.pause_flags, START_AUCTION_PAUSE),
        AuctionStateErrors::FunctionPaused
    );

    require!(
        auction.status == AuctionState::Initialized,
        AuctionStateErrors::AuctionAlreadyStarted
    );

    let now = Clock::get()?.unix_timestamp;
    require_gte!(
        now,
        auction.start_time,
        AuctionStateErrors::AuctionNotStarted
    );

    auction.status = AuctionState::Active;

    emit!(AuctionStarted {
        auction_id: auction.auction_id,
        started_at: now,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(auction_id: u32)]
pub struct StartAuction<'info> {
    #[account(
        seeds = [b"auction"], 
        bump = auction_config.config_bump, 
        constraint = auction_config.auction_admin == auction_admin.key() @ConfigStateErrors::InvalidAuctionAdmin
    )]
    pub auction_config: Box<Account<'info, AuctionConfig>>,

    #[account(
        mut, 
        seeds = [b"auction", auction_id.to_le_bytes().as_ref()], 
        bump = auction.auction_bump, 
        constraint = auction.auction_id == auction_id @AuctionStateErrors::InvalidAuctionId
    )]
    pub auction: Box<Account<'info, Auction>>,

    pub auction_admin: Signer<'info>,
}
