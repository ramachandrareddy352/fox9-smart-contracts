use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use crate::constants::CREATE_AUCTION_PAUSE;
use crate::errors::{AuctionStateErrors, ConfigStateErrors};
use crate::helpers::*;
use crate::states::*;
use crate::utils::*;

#[event]
pub struct AuctionCreated {
    pub auction_id: u32,
    pub creator: Pubkey,
    pub prize_mint: Pubkey,
    pub start_time: i64,
    pub end_time: i64,
    pub created_at: i64,
}

pub fn create_auction(
    ctx: Context<CreateAuction>,
    mut start_time: i64,
    end_time: i64,
    start_immediately: bool,
    is_bid_mint_sol: bool,
    base_bid: u64, // base bid can be zero also
    min_increment: u64,
    time_extension: u32,
) -> Result<()> {
    let config = &mut ctx.accounts.auction_config;

    require!(
        !is_paused(config.pause_flags, CREATE_AUCTION_PAUSE),
        AuctionStateErrors::FunctionPaused
    );

    let auction = &mut ctx.accounts.auction;
    let creator = &ctx.accounts.creator;
    let now = Clock::get()?.unix_timestamp;

    require_gt!(min_increment, 0, AuctionStateErrors::InvalidZeroAmount);

    if start_immediately {
        start_time = now;
    }
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

    require_gte!(start_time, now, AuctionStateErrors::StartTimeInPast);

    // Validate NFT mint passed in accounts
    validate_nft(&ctx.accounts.prize_mint)?;

    // Initialize auction state
    auction.auction_id = config.auction_count;
    auction.creator = creator.key();
    auction.prize_mint = ctx.accounts.prize_mint.key();
    auction.start_time = start_time;
    auction.end_time = end_time;
    auction.bid_mint = if is_bid_mint_sol {
        None
    } else {
        Some(ctx.accounts.bid_mint.key())
    };
    auction.base_bid = base_bid;
    auction.min_increment = min_increment;
    auction.time_extension = time_extension;
    auction.highest_bid_amount = base_bid;
    auction.highest_bidder = Pubkey::default();
    auction.has_any_bid = false;
    auction.status = if start_immediately {
        AuctionState::Active
    } else {
        AuctionState::Initialized
    };
    auction.auction_bump = ctx.bumps.auction;

    // Increment global counter
    config.auction_count = config
        .auction_count
        .checked_add(1)
        .ok_or(AuctionStateErrors::Overflow)?;

    // transfer NFT from creator -> prize_escrow
    transfer_tokens(
        &ctx.accounts.creator_prize_ata,
        &ctx.accounts.prize_escrow,
        creator,
        &ctx.accounts.prize_token_program,
        &ctx.accounts.prize_mint,
        1u64,
    )?;

    if config.creation_fee_lamports > 0 {
        transfer_sol(
            creator,
            &config.to_account_info(),
            &ctx.accounts.system_program,
            config.creation_fee_lamports,
        )?;
    }

    emit!(AuctionCreated {
        auction_id: auction.auction_id,
        creator: creator.key(),
        prize_mint: auction.prize_mint,
        start_time: auction.start_time,
        end_time: auction.end_time,
        created_at: now,
    });

    Ok(())
}

// If auction accepts SPL bids, the bid escrow ATA will be created later when first bid occurs
#[derive(Accounts)]
pub struct CreateAuction<'info> {
    #[account(
        mut,
        seeds = [b"auction"], 
        bump = auction_config.config_bump, 
        constraint = auction_config.auction_admin == auction_admin.key() @ ConfigStateErrors::InvalidAuctionAdmin
    )]
    pub auction_config: Box<Account<'info, AuctionConfig>>,

    #[account(
        init, 
        payer = creator, 
        space = 8 + Auction::INIT_SPACE, 
        seeds = [b"auction", auction_config.auction_count.to_le_bytes().as_ref()],
        bump
    )]
    pub auction: Box<Account<'info, Auction>>,

    #[account(mut)]
    pub creator: Signer<'info>,

    pub auction_admin: Signer<'info>,

    pub prize_mint: InterfaceAccount<'info, Mint>,
    pub bid_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut, 
        associated_token::mint = prize_mint,
        associated_token::authority = creator,
        associated_token::token_program = prize_token_program
    )]
    pub creator_prize_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = creator,
        associated_token::mint = prize_mint,
        associated_token::authority = auction,
        associated_token::token_program = prize_token_program
    )]
    pub prize_escrow: InterfaceAccount<'info, TokenAccount>,

    pub prize_token_program: Interface<'info, TokenInterface>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
