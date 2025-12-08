use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{close_account, CloseAccount};
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use crate::constants::*;
use crate::errors::{ConfigStateErrors, GumballStateErrors, KeysMismatchErrors};
use crate::helpers::*;
use crate::states::*;
use crate::utils::is_paused;

#[event]
pub struct PrizeSpinned {
    pub gumball_id: u32,
    pub prize_index: u16,
    pub prize_mint: Pubkey,
    pub prize_amount: u64,
    pub winner: Pubkey,
    pub spun_at: i64,
}

pub fn spin_gumball(ctx: Context<SpinGumball>, gumball_id: u32, prize_index: u16) -> Result<()> {
    // Pause check
    require!(
        !is_paused(ctx.accounts.gumball_config.pause_flags, SPIN_GUMBALL_PAUSE),
        GumballStateErrors::FunctionPaused
    );

    // Extract account infos first (avoid borrow conflicts)
    let gumball_ai = ctx.accounts.gumball.to_account_info();

    // Now mutable borrow gumball & prize
    let gumball = &mut ctx.accounts.gumball;
    let prize_acc = &mut ctx.accounts.prize;

    let now = Clock::get()?.unix_timestamp;

    // Must be Active
    require!(
        gumball.status == GumballState::Active,
        GumballStateErrors::InvalidGumballState
    );

    // Time window check
    require_gte!(gumball.end_time, now, GumballStateErrors::EndTimeIsReached);

    // Ensure there are prizes available relative to sold tickets
    require_gt!(
        gumball.prizes_added,
        gumball.tickets_sold,
        GumballStateErrors::PrizesExceedTickets
    );

    // Verify ticket mint matches provided mint account
    require_keys_eq!(
        prize_acc.mint,
        ctx.accounts.prize_mint.key(),
        GumballStateErrors::PrizeMintMismatch
    );

    // Ensure prize has remaining quantity
    require_gt!(
        prize_acc.quantity,
        0u16,
        GumballStateErrors::InvalidPrizeQuantity
    );

    // Determine transfer amount: one unit of prize (per your design prize_amount is per unit)
    let transfer_amount = prize_acc.prize_amount;

    // Update on-chain prize counts
    prize_acc.quantity = prize_acc
        .quantity
        .checked_sub(1)
        .ok_or(GumballStateErrors::Overflow)?;

    // Optionally decrement total_amount if you keep that field updated
    prize_acc.total_amount = prize_acc
        .total_amount
        .checked_sub(transfer_amount)
        .unwrap_or(0);

    // Update gumball increase tickets_sold here
    gumball.tickets_sold = gumball
        .tickets_sold
        .checked_add(1)
        .ok_or(GumballStateErrors::Overflow)?;

    // Build signer seeds for gumball PDA (gumball is the authority over escrow ATAs)
    let gumball_id_bytes = gumball.gumball_id.to_le_bytes();
    let seeds: &[&[u8]] = &[b"gumball", &gumball_id_bytes, &[gumball.gumball_bump]];
    let signer_seeds: &[&[&[u8]]] = &[seeds];

    // Perform token transfer: prize_escrow (owned by gumball PDA) -> spinner_ata
    transfer_tokens_with_seeds(
        &ctx.accounts.prize_escrow,
        &ctx.accounts.spinner_prize_ata,
        &gumball_ai, // authority is gumball PDA
        &ctx.accounts.prize_token_program,
        &ctx.accounts.prize_mint,
        signer_seeds,
        transfer_amount,
    )?;

    let ticket_price = gumball.ticket_price;

    // collect ticket prize and send to escrow if SPL , or it ticket mint is None then transfer sol to gumball struct directely for singel ticket
    match gumball.ticket_mint {
        None => {
            // SOL ticket
            transfer_sol(
                &ctx.accounts.spinner,
                &gumball_ai,
                &ctx.accounts.system_program,
                ticket_price,
            )?;
        }

        Some(stored_mint) => {
            // SPL ticket payments
            require!(
                ctx.accounts.ticket_mint.key() == stored_mint
                    && ctx.accounts.ticket_escrow.mint == stored_mint
                    && ctx.accounts.spinner_ticket_ata.mint == stored_mint,
                KeysMismatchErrors::InvalidTicketMint
            );

            // spinner_ticket_ata must be owned by spinner
            require_keys_eq!(
                ctx.accounts.spinner_ticket_ata.owner,
                ctx.accounts.spinner.key(),
                KeysMismatchErrors::InvalidTicketAtaOwner
            );

            // ticket_escrow owner must be gumball PDA
            require_keys_eq!(
                ctx.accounts.ticket_escrow.owner,
                gumball.key(),
                KeysMismatchErrors::InvalidTicketEscrowOwner
            );

            // Transfer ticket_price SPL tokens from spinner → gumball ticket escrow
            transfer_tokens(
                &ctx.accounts.spinner_ticket_ata,
                &ctx.accounts.ticket_escrow,
                &ctx.accounts.spinner,
                &ctx.accounts.ticket_token_program,
                &ctx.accounts.ticket_mint,
                ticket_price,
            )?;
        }
    }

    if prize_acc.quantity == 0 {
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.prize_token_program.to_account_info(), // token_program
            CloseAccount {
                account: ctx.accounts.prize_escrow.to_account_info(),
                destination: ctx.accounts.spinner.to_account_info(),
                authority: gumball_ai,
            },
            signer_seeds,
        );
        close_account(cpi_ctx)?;
    }

    // Emit event
    emit!(PrizeSpinned {
        gumball_id,
        prize_index,
        prize_mint: ctx.accounts.prize_mint.key(),
        prize_amount: transfer_amount,
        winner: ctx.accounts.spinner.key(),
        spun_at: now,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(gumball_id: u32, prize_index: u16)]
pub struct SpinGumball<'info> {
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

    #[account(
        mut,
        seeds = [b"gumball", gumball_id.to_le_bytes().as_ref(), prize_index.to_le_bytes().as_ref()],
        bump,
        constraint = prize.gumball_id == gumball_id @ GumballStateErrors::InvalidGumballId,
        constraint = prize.prize_index == prize_index @ GumballStateErrors::InvalidPrizeIndex
    )]
    pub prize: Box<Account<'info, Prize>>,

    /// Player who will receive the prize
    #[account(mut)]
    pub spinner: Signer<'info>,

    pub gumball_admin: Signer<'info>,

    pub prize_mint: InterfaceAccount<'info, Mint>,

    pub ticket_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = prize_mint,
        associated_token::authority = gumball,
        associated_token::token_program = prize_token_program
    )]
    pub prize_escrow: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = spinner,
        associated_token::mint = prize_mint,
        associated_token::authority = spinner,
        associated_token::token_program = prize_token_program
    )]
    pub spinner_prize_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub ticket_escrow: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub spinner_ticket_ata: InterfaceAccount<'info, TokenAccount>,

    /// Token program
    pub prize_token_program: Interface<'info, TokenInterface>,
    pub ticket_token_program: Interface<'info, TokenInterface>,

    /// system Programs
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
