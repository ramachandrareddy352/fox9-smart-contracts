use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{close_account, CloseAccount};
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use crate::constants::*;
use crate::errors::{ConfigStateErrors, GumballStateErrors};
use crate::helpers::*;
use crate::states::*;
use crate::utils::is_paused;

#[event]
pub struct PrizeClaimed {
    pub gumball_id: u32,
    pub prize_index: u16,
    pub prize_mint: Pubkey,
    pub claimed_amount: u64,
    pub claimer: Pubkey,
    pub claimed_at: i64,
}

// Claim remaining tokens for a prize back to the creator.
// This will transfer all `remaining_quantity * prize_amount` from the prize escrow to the creator ATA,
// then close the prize account and the prize escrow ATA (rent goes to creator).
pub fn claim_prize_back(
    ctx: Context<ClaimPrizeBack>,
    gumball_id: u32,
    prize_index: u16,
) -> Result<()> {
    // Pause check
    require!(
        !is_paused(
            ctx.accounts.gumball_config.pause_flags,
            CLAIM_PRIZES_BACK_PAUSE
        ),
        GumballStateErrors::FunctionPaused
    );

    // Prepare
    let gumball_ai = ctx.accounts.gumball.to_account_info();
    let now = Clock::get()?.unix_timestamp;

    // Mutable accounts
    let gumball = &ctx.accounts.gumball;
    let prize = &mut ctx.accounts.prize;
    let creator = &ctx.accounts.creator;

    // Only allow when gumball is in terminal states
    require!(
        gumball.status == GumballState::Cancelled
            || gumball.status == GumballState::CompletedSuccessfully
            || gumball.status == GumballState::CompletedFailed,
        GumballStateErrors::InvalidGumballState
    );

    // Validate prize mint / escrow mapping
    require_keys_eq!(
        prize.mint,
        ctx.accounts.prize_mint.key(),
        GumballStateErrors::PrizeMintMismatch
    );

    let claimable_amount = ctx.accounts.prize_escrow.amount;

    // Ensure there is something to claim, if theer are no prizes then we close account and send rent to creator
    // require_gt!(
    //     claimable_amount,
    //     0u64,
    //     GumballStateErrors::InvalidPrizeQuantity
    // );

    let gumball_id_bytes = gumball.gumball_id.to_le_bytes();
    let seeds: &[&[u8]] = &[b"gumball", &gumball_id_bytes, &[gumball.gumball_bump]];
    let signer_seeds: &[&[&[u8]]] = &[seeds];

    // Build signer seeds for gumball PDA (authority over prize_escrow ATA)
    if claimable_amount > 0 {
        // Transfer tokens from prize_escrow -> creator_prize_ata using gumball PDA as signer
        transfer_tokens_with_seeds(
            &ctx.accounts.prize_escrow,
            &ctx.accounts.creator_prize_ata,
            &gumball_ai,
            &ctx.accounts.prize_token_program,
            &ctx.accounts.prize_mint,
            signer_seeds,
            claimable_amount,
        )?;
    }

    // Set remaining to zero
    prize.quantity = 0;
    prize.total_amount = 0;

    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.prize_token_program.to_account_info(), // token_program
        CloseAccount {
            account: ctx.accounts.prize_escrow.to_account_info(),
            destination: ctx.accounts.creator.to_account_info(),
            authority: gumball_ai,
        },
        signer_seeds,
    );
    close_account(cpi_ctx)?;

    // Emit event
    emit!(PrizeClaimed {
        gumball_id,
        prize_index,
        prize_mint: ctx.accounts.prize_mint.key(),
        claimed_amount: claimable_amount,
        claimer: creator.key(),
        claimed_at: now,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(gumball_id: u32, prize_index: u16)]
pub struct ClaimPrizeBack<'info> {
    #[account(
        seeds = [b"gumball"],
        bump = gumball_config.config_bump,
        constraint = gumball_config.gumball_admin == gumball_admin.key() @ ConfigStateErrors::InvalidGumballAdmin
    )]
    pub gumball_config: Box<Account<'info, GumballConfig>>,

    #[account(
        mut,
        seeds = [b"gumball", gumball_id.to_le_bytes().as_ref()],
        bump = gumball.gumball_bump,
        constraint = gumball.gumball_id == gumball_id @ GumballStateErrors::InvalidGumballId
    )]
    pub gumball: Box<Account<'info, GumballMachine>>,

    // Prize PDA (will be closed and rent sent to creator)
    #[account(
        mut,
        close = creator,
        seeds = [b"gumball", gumball_id.to_le_bytes().as_ref(), prize_index.to_le_bytes().as_ref()],
        bump,
        constraint = prize.gumball_id == gumball_id @ GumballStateErrors::InvalidGumballId,
        constraint = prize.prize_index == prize_index @ GumballStateErrors::InvalidPrizeIndex,
    )]
    pub prize: Account<'info, Prize>,

    // Creator (must match gumball.creator) — receives rent from closed accounts
    #[account(
        mut,
        constraint = creator.key() == gumball.creator @ GumballStateErrors::InvalidCreator
    )]
    pub creator: Signer<'info>,

    pub gumball_admin: Signer<'info>,

    pub prize_mint: InterfaceAccount<'info, Mint>,

    // Prize escrow ATA owned by gumball PDA that currently holds the prize tokens.
    // We'll transfer everything out and then close this ATA (close = creator).
    #[account(
        mut,
        associated_token::mint = prize_mint,
        associated_token::authority = gumball,
        associated_token::token_program = prize_token_program,
    )]
    pub prize_escrow: InterfaceAccount<'info, TokenAccount>,

    // Creator's ATA for the prize mint (destination for returned tokens). Must already exist.
    #[account(
        mut,
        associated_token::mint = prize_mint,
        associated_token::authority = creator,
        associated_token::token_program = prize_token_program
    )]
    pub creator_prize_ata: InterfaceAccount<'info, TokenAccount>,

    // Token program
    pub prize_token_program: Interface<'info, TokenInterface>,

    // Programs
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
