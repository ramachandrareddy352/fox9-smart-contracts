use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use crate::constants::{COMPLETE_AUCTION_PAUSE, FEE_MANTISSA};
use crate::errors::{AuctionStateErrors, ConfigStateErrors, KeysMismatchErrors};
use crate::helpers::*;
use crate::states::*;
use crate::utils::*;

#[event]
pub struct AuctionCompleted {
    pub auction_id: u32,
    pub winner: Option<Pubkey>,
    pub final_price: u64,
    pub creator_amount: u64,
    pub fee_amount: u64,
    pub completed_at: i64,
}

// send the prize back in another function that and then close the auction struct
pub fn complete_auction(ctx: Context<CompleteAuction>, auction_id: u32) -> Result<()> {
    require!(
        !is_paused(
            ctx.accounts.auction_config.pause_flags,
            COMPLETE_AUCTION_PAUSE
        ),
        AuctionStateErrors::FunctionPaused
    );

    let auction = &mut ctx.accounts.auction;
    let now = Clock::get()?.unix_timestamp;

    require!(
        auction.status == AuctionState::Active,
        AuctionStateErrors::AuctionAlreadyCompleted
    );
    require_gt!(now, auction.end_time, AuctionStateErrors::AuctionNotStarted);

    // If no bids, return NFT to creator
    if !auction.has_any_bid {
        // transfer NFT back
        transfer_tokens_with_seeds(
            &ctx.accounts.prize_escrow,
            &ctx.accounts.creator_prize_ata,
            &auction.to_account_info(),
            &ctx.accounts.prize_token_program,
            &ctx.accounts.prize_mint,
            &[&[
                b"auction",
                &auction.auction_id.to_le_bytes(),
                &[auction.auction_bump],
            ]],
            1u64,
        )?;

        auction.status = AuctionState::CompletedFailed;

        emit!(AuctionCompleted {
            auction_id: auction_id,
            winner: None,
            final_price: 0,
            creator_amount: 0,
            fee_amount: 0,
            completed_at: now,
        });

        return Ok(());
    }

    // There is a winner
    let final_price = auction.highest_bid_amount;
    let commission_bps = ctx.accounts.auction_config.commission_bps as u64;

    let fee_amount = get_pct_amount(final_price, commission_bps, FEE_MANTISSA as u64)?;
    let creator_amount = final_price
        .checked_sub(fee_amount)
        .ok_or(AuctionStateErrors::Overflow)?;

    let prize_mint_key = auction.prize_mint;

    // checking the keys mismatch
    require!(
        ctx.accounts.prize_mint.key() == prize_mint_key
            && ctx.accounts.winner_prize_ata.mint == prize_mint_key,
        KeysMismatchErrors::InvalidPrizeMint
    );

    require_keys_eq!(
        ctx.accounts.winner_prize_ata.owner,
        ctx.accounts.winner.key(),
        KeysMismatchErrors::InvalidPrizeAtaOwner
    );

    let seeds: &[&[u8]] = &[
        b"auction",
        &auction.auction_id.to_le_bytes(),
        &[auction.auction_bump],
    ];
    let signer_seeds: &[&[&[u8]]] = &[seeds];

    transfer_tokens_with_seeds(
        &ctx.accounts.prize_escrow,
        &ctx.accounts.winner_prize_ata,
        &auction.to_account_info(),
        &ctx.accounts.prize_token_program,
        &ctx.accounts.prize_mint,
        signer_seeds,
        1u64,
    )?;

    // Distribute funds: depends on SOL or SPL bidding
    match auction.bid_mint {
        None => {
            // SOL: auction PDA holds lamports equal to final_price
            // Transfer fee to config
            transfer_sol_with_seeds(
                &auction.to_account_info(),
                &ctx.accounts.auction_config.to_account_info(),
                &ctx.accounts.system_program,
                &[seeds],
                fee_amount,
            )?;
            // Transfer creator amount to creator
            transfer_sol_with_seeds(
                &auction.to_account_info(),
                &ctx.accounts.creator,
                &ctx.accounts.system_program,
                &[seeds],
                creator_amount,
            )?;
        }
        Some(stored_mint) => {
            // SPL: bid_escrow holds the funds; fee_treasury ATA (owned by config PDA) receives fee
            // validate provided accounts
            require!(
                ctx.accounts.bid_mint.key() == stored_mint
                    && ctx.accounts.bid_escrow.mint == stored_mint
                    && ctx.accounts.bid_fee_treasury_ata.mint == stored_mint
                    && ctx.accounts.creator_bid_ata.mint == stored_mint,
                KeysMismatchErrors::InvalidBidMint
            );

            require_keys_eq!(
                ctx.accounts.bid_escrow.owner,
                auction.key(),
                KeysMismatchErrors::InvalidBidEscrowOwner
            );

            require!(
                ctx.accounts.bid_fee_treasury_ata.owner == ctx.accounts.auction_config.key()
                    && ctx.accounts.creator_bid_ata.owner == ctx.accounts.creator.key(),
                KeysMismatchErrors::InvalidBidAtaOwner
            );

            // fee -> bid_fee_treasury_ata (owned by auction_config PDA)
            transfer_tokens_with_seeds(
                &ctx.accounts.bid_escrow,
                &ctx.accounts.bid_fee_treasury_ata,
                &auction.to_account_info(),
                &ctx.accounts.bid_token_program,
                &ctx.accounts.bid_mint,
                &[seeds],
                fee_amount,
            )?;

            // creator_amount -> creator_ata
            transfer_tokens_with_seeds(
                &ctx.accounts.bid_escrow,
                &ctx.accounts.creator_bid_ata,
                &auction.to_account_info(),
                &ctx.accounts.bid_token_program,
                &ctx.accounts.bid_mint,
                &[seeds],
                creator_amount,
            )?;
        }
    }

    auction.status = AuctionState::CompletedSuccessfully;

    emit!(AuctionCompleted {
        auction_id: auction_id,
        winner: Some(auction.highest_bidder),
        final_price,
        creator_amount,
        fee_amount,
        completed_at: now,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(auction_id: u32)]
pub struct CompleteAuction<'info> {
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

    #[account(mut)]
    pub auction_admin: Signer<'info>,

    #[account(
        mut,
        constraint = auction.creator == creator.key() @ AuctionStateErrors::InvalidCreator
    )]
    pub creator: AccountInfo<'info>,

    #[account(mut)]
    pub winner: AccountInfo<'info>,

    pub prize_mint: InterfaceAccount<'info, Mint>,
    pub bid_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        token::mint = prize_mint,
        token::authority = auction,
        token::token_program = prize_token_program
    )]
    pub prize_escrow: InterfaceAccount<'info, TokenAccount>,

    // For SPL payouts (if used)
    #[account(mut)]
    pub bid_escrow: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = prize_mint,
        token::authority = creator,
        token::token_program = prize_token_program
    )]
    pub creator_prize_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)] // check inside
    pub winner_prize_ata: InterfaceAccount<'info, TokenAccount>,

    // owner by config account
    #[account(mut)]
    pub bid_fee_treasury_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub creator_bid_ata: InterfaceAccount<'info, TokenAccount>,

    pub prize_token_program: Interface<'info, TokenInterface>,
    pub bid_token_program: Interface<'info, TokenInterface>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
