use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{close_account, CloseAccount};
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::CANCEL_AUCTION_PAUSE;
use crate::errors::{AuctionStateErrors, ConfigStateErrors};
use crate::helpers::*;
use crate::states::*;
use crate::utils::is_paused;

#[event]
pub struct AuctionCancelled {
    pub auction_id: u32,
    pub cancelled_by: Pubkey,
    pub cancelled_time: i64,
}

pub fn cancel_auction(ctx: Context<CancelAuction>, _auction_id: u32) -> Result<()> {
    require!(
        !is_paused(
            ctx.accounts.auction_config.pause_flags,
            CANCEL_AUCTION_PAUSE
        ),
        AuctionStateErrors::FunctionPaused
    );

    let auction = &mut ctx.accounts.auction;
    let creator = &ctx.accounts.creator;

    require!(
        auction.status == AuctionState::Initialized || auction.status == AuctionState::Active,
        AuctionStateErrors::AuctionAlreadyCompleted
    );

    require!(!auction.has_any_bid, AuctionStateErrors::AuctionHasBids);

    auction.status = AuctionState::Cancelled;

    let auction_id_bytes = auction.auction_id.to_le_bytes();
    let bump_bytes = [auction.auction_bump];
    let signer_seeds: &[&[u8]] = &[b"auction", &auction_id_bytes, &bump_bytes];
    let signer: &[&[&[u8]]] = &[signer_seeds];

    // transfer NFT back
    transfer_tokens_with_seeds(
        &ctx.accounts.prize_escrow,
        &ctx.accounts.creator_prize_ata,
        &auction.to_account_info(),
        &ctx.accounts.prize_token_program,
        &ctx.accounts.prize_mint,
        signer,
        1u64,
    )?;

    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.prize_token_program.to_account_info(), // token_program
        CloseAccount {
            account: ctx.accounts.prize_escrow.to_account_info(),
            destination: creator.to_account_info(),
            authority: auction.to_account_info(),
        },
        signer,
    );

    close_account(cpi_ctx)?;

    emit!(AuctionCancelled {
        auction_id: auction.auction_id,
        cancelled_by: creator.key(),
        cancelled_time: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(auction_id: u32)]
pub struct CancelAuction<'info> {
    #[account(
        seeds = [b"auction"], 
        bump = auction_config.config_bump, 
        constraint = auction_config.auction_admin == auction_admin.key() @ConfigStateErrors::InvalidAuctionAdmin
    )]
    pub auction_config: Box<Account<'info, AuctionConfig>>,

    #[account(
        mut, 
        close = creator,
        seeds = [b"auction", auction_id.to_le_bytes().as_ref()], 
        bump = auction.auction_bump, 
        constraint = auction.auction_id == auction_id @AuctionStateErrors::InvalidAuctionId
    )]
    pub auction: Box<Account<'info, Auction>>,

    #[account(
        mut, 
        constraint = creator.key() == auction.creator @AuctionStateErrors::InvalidCreator
    )]
    pub creator: Signer<'info>,

    pub auction_admin: Signer<'info>,

    pub prize_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = prize_mint,
        associated_token::authority = auction,
        associated_token::token_program = prize_token_program
    )]
    pub prize_escrow: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = creator,
        associated_token::mint = prize_mint,
        associated_token::authority = creator,
        associated_token::token_program = prize_token_program
    )]
    pub creator_prize_ata: InterfaceAccount<'info, TokenAccount>,

    pub prize_token_program: Interface<'info, TokenInterface>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
