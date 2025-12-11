use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use crate::constants::PLACE_BID_PAUSE;
use crate::errors::{AuctionStateErrors, ConfigStateErrors, KeysMismatchErrors};
use crate::helpers::*;
use crate::states::*;
use crate::utils::is_paused;

#[event]
pub struct BidPlaced {
    pub auction_id: u32,
    pub bidder: Pubkey,
    pub new_bid: u64,
    pub bid_time: i64,
}

// Place bid: supports SOL (auction.bid_mint == None) or SPL (auction.bid_mint == Some(mint))
pub fn place_bid(ctx: Context<PlaceBid>, _auction_id: u32, bid_amount: u64) -> Result<()> {
    require!(
        !is_paused(ctx.accounts.auction_config.pause_flags, PLACE_BID_PAUSE),
        AuctionStateErrors::FunctionPaused
    );

    let auction = &mut ctx.accounts.auction;
    let bidder = &ctx.accounts.bidder;
    let now = Clock::get()?.unix_timestamp;

    require!(
        auction.status == AuctionState::Active,
        AuctionStateErrors::AuctionNotActive
    );
    require_gt!(auction.end_time, now, AuctionStateErrors::AuctionNotStarted);

    // cannot be same as previous highest
    require!(
        bidder.key() != auction.highest_bidder,
        AuctionStateErrors::CannotBidOwnHighBid
    );

    // bid must be >= highest_bid + min_increment
    let min_required = auction
        .highest_bid_amount
        .checked_add(auction.min_increment)
        .ok_or(AuctionStateErrors::Overflow)?;
    require_gte!(bid_amount, min_required, AuctionStateErrors::BidTooLow);

    // Collect new bid from bidder into auction escrow (SOL or SPL)
    match auction.bid_mint {
        None => {
            // SOL — bidder must transfer lamports to auction PDA directly (signed by bidder)
            // We perform a CPI that transfers lamports from bidder to auction PDA
            transfer_sol(
                bidder,
                &auction.to_account_info(),
                &ctx.accounts.system_program,
                bid_amount,
            )?;
        }
        Some(stored_mint) => {
            // SPL: transfer from bidder_ata to bid_escrow (provided)
            let bid_mint = ctx.accounts.bid_mint.key();
            require_keys_eq!(bid_mint, stored_mint, KeysMismatchErrors::InvalidBidMint);

            // check for bid escrow
            require_keys_eq!(
                ctx.accounts.bid_escrow.mint,
                stored_mint,
                KeysMismatchErrors::InvalidBidMint
            );
            require_keys_eq!(
                ctx.accounts.bid_escrow.owner,
                auction.key(),
                KeysMismatchErrors::InvalidBidEscrowOwner
            );

            // check for current bid owner ATA
            require_keys_eq!(
                ctx.accounts.current_bidder_ata.mint,
                stored_mint,
                KeysMismatchErrors::InvalidBidMint
            );
            require_keys_eq!(
                ctx.accounts.current_bidder_ata.owner,
                bidder.key(),
                KeysMismatchErrors::InvalidBidAtaOwner
            );

            // transfer tokens
            transfer_tokens(
                &ctx.accounts.current_bidder_ata,
                &ctx.accounts.bid_escrow,
                bidder,
                &ctx.accounts.bid_token_program,
                &ctx.accounts.bid_mint,
                bid_amount,
            )?;
        }
    }

    // Handle refund of previous highest bidder
    let refunded_amount: u64 = auction.highest_bid_amount;

    let seeds: &[&[u8]] = &[
        b"auction",
        &auction.auction_id.to_le_bytes(),
        &[auction.auction_bump],
    ];
    let signer_seeds = &[seeds];

    // Refund previous highest bidder: for SPL we transfer tokens back, for SOL we transfer lamports back.
    if auction.has_any_bid {
        match auction.bid_mint {
            None => {
                // SOL refund: we require prev_bidder_account account provided and use system_program transfer from auction PDA.
                let prev_account = &ctx.accounts.prev_bidder_account;

                require_keys_eq!(
                    prev_account.key(),
                    auction.highest_bidder,
                    KeysMismatchErrors::InvalidPreviousBidOwner
                );

                transfer_sol_with_seeds(
                    &auction.to_account_info(),
                    prev_account,
                    refunded_amount,
                )?;
            }
            Some(stored_mint) => {
                // SPL refund: transfer from bid_escrow back to prev_bidder_ata using auction PDA signer
                require_keys_eq!(
                    ctx.accounts.prev_bidder_ata.mint,
                    stored_mint,
                    KeysMismatchErrors::InvalidBidMint
                );
                require_keys_eq!(
                    ctx.accounts.prev_bidder_ata.owner,
                    auction.highest_bidder,
                    KeysMismatchErrors::InvalidPreviousBidOwner
                );

                transfer_tokens_with_seeds(
                    &ctx.accounts.bid_escrow,
                    &ctx.accounts.prev_bidder_ata,
                    &auction.to_account_info(),
                    &ctx.accounts.bid_token_program,
                    &ctx.accounts.bid_mint,
                    signer_seeds,
                    refunded_amount,
                )?;
            }
        }
    }

    // Update auction state
    auction.highest_bid_amount = bid_amount;
    auction.highest_bidder = bidder.key();
    auction.has_any_bid = true;
    auction.end_time = auction
        .end_time
        .checked_add(auction.time_extension as i64)
        .ok_or(AuctionStateErrors::Overflow)?;

    emit!(BidPlaced {
        auction_id: auction.auction_id,
        bidder: bidder.key(),
        new_bid: bid_amount,
        bid_time: now,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(auction_id: u32)]
pub struct PlaceBid<'info> {
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

    #[account(mut)]
    pub bidder: Signer<'info>,

    pub auction_admin: Signer<'info>,

    // previous bidder system account to refund SOL (if needed)
    #[account(mut)]
    pub prev_bidder_account: AccountInfo<'info>,

    pub bid_mint: InterfaceAccount<'info, Mint>,

    // bidder's ATA for bid_mint
    #[account(mut)]
    pub current_bidder_ata: InterfaceAccount<'info, TokenAccount>,

    // previous bidder's ATA to refund (SPL)
    #[account(mut)]
    pub prev_bidder_ata: InterfaceAccount<'info, TokenAccount>,

    // escrow that holds bid tokens, owner is auction struct
    #[account(mut)]
    pub bid_escrow: InterfaceAccount<'info, TokenAccount>,

    // programs
    pub bid_token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}
