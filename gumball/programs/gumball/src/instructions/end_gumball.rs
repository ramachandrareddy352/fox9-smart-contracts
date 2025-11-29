use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use crate::constants::*;
use crate::errors::{ConfigStateErrors, GumballStateErrors, KeysMismatchErrors};
use crate::helpers::*;
use crate::states::*;
use crate::utils::*;

#[event]
pub struct GumballEnded {
    pub gumball_id: u32,
    pub total_sold: u16,
    pub fee_amount: u64,
    pub creator_amount: u64,
    pub ended_at: i64,
}

pub fn end_gumball(ctx: Context<EndGumball>, gumball_id: u32) -> Result<()> {
    let gumball_ai = ctx.accounts.gumball.to_account_info();
    let config = &ctx.accounts.gumball_config;
    let gumball = &mut ctx.accounts.gumball;
    let now = Clock::get()?.unix_timestamp;

    // Pause check
    require!(
        !is_paused(config.pause_flags, END_GUMBALL_PAUSE),
        GumballStateErrors::FunctionPaused
    );

    // Must be active
    require!(
        gumball.status == GumballState::Active,
        GumballStateErrors::InvalidGumballState
    );

    // End time must have passed
    require_gt!(now, gumball.end_time, GumballStateErrors::EndTimeNotReached);

    // Revenue calculations
    let tickets_sold = gumball.tickets_sold;

    if tickets_sold == 0 {
        // Update status
        gumball.status = GumballState::CompletedFailed;

        emit!(GumballEnded {
            gumball_id,
            total_sold: 0,
            fee_amount: 0,
            creator_amount: 0,
            ended_at: now,
        });

        return Ok(());
    }

    let total_amount = gumball
        .ticket_price
        .checked_mul(tickets_sold as u64)
        .ok_or(GumballStateErrors::Overflow)?;

    let fee_amount = get_pct_amount(
        total_amount,
        config.ticket_fee_bps as u64,
        FEE_MANTISSA as u64,
    )?;
    let creator_amount = total_amount
        .checked_sub(fee_amount)
        .ok_or(GumballStateErrors::Overflow)?;

    let gumball_id_bytes = gumball.gumball_id.to_le_bytes();
    let seeds: &[&[u8]] = &[b"gumball", &gumball_id_bytes, &[gumball.gumball_bump]];
    let signer_seeds: &[&[&[u8]]] = &[seeds];

    // Case A — SOL mode
    match gumball.ticket_mint {
        None => {
            // Transfer fee to config
            transfer_sol_with_seeds(
                &gumball_ai,
                &config.to_account_info(),
                &ctx.accounts.system_program,
                signer_seeds,
                fee_amount,
            )?;

            // Transfer remaining to creator
            transfer_sol_with_seeds(
                &gumball_ai,
                &ctx.accounts.creator,
                &ctx.accounts.system_program,
                signer_seeds,
                creator_amount,
            )?;
        }
        // Case B — SPL mode
        Some(stored_mint) => {
            require!(
                ctx.accounts.ticket_mint.key() == stored_mint
                    && ctx.accounts.ticket_escrow.mint == stored_mint
                    && ctx.accounts.ticket_fee_escrow_ata.mint == stored_mint
                    && ctx.accounts.creator_ticket_ata.mint == stored_mint,
                KeysMismatchErrors::InvalidTicketMint
            );

            require_keys_eq!(
                ctx.accounts.ticket_escrow.owner,
                gumball.key(),
                KeysMismatchErrors::InvalidTicketEscrowOwner
            );
            require_keys_eq!(
                ctx.accounts.ticket_fee_escrow_ata.owner,
                config.key(),
                KeysMismatchErrors::InvalidFeeTreasuryAtaOwner
            );
            require_keys_eq!(
                ctx.accounts.creator_ticket_ata.owner,
                ctx.accounts.creator.key(),
                KeysMismatchErrors::InvalidTicketAtaOwner
            );

            // Transfer fee to fee escrow PDA ATA
            transfer_tokens_with_seeds(
                &ctx.accounts.ticket_escrow,
                &ctx.accounts.ticket_fee_escrow_ata,
                &gumball_ai,
                &ctx.accounts.ticket_token_program,
                &ctx.accounts.ticket_mint,
                signer_seeds,
                fee_amount,
            )?;

            // Transfer remaining amount to creator ATA
            transfer_tokens_with_seeds(
                &ctx.accounts.ticket_escrow,
                &ctx.accounts.creator_ticket_ata,
                &gumball_ai,
                &ctx.accounts.ticket_token_program,
                &ctx.accounts.ticket_mint,
                signer_seeds,
                creator_amount,
            )?;
        }
    }

    // Update status
    gumball.status = GumballState::CompletedSuccessfully;

    emit!(GumballEnded {
        gumball_id,
        total_sold: gumball.tickets_sold,
        fee_amount,
        creator_amount,
        ended_at: now,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(gumball_id: u32)]
pub struct EndGumball<'info> {
    #[account(
        seeds = [b"gumball"],
        bump = gumball_config.config_bump,
        constraint = gumball_config.gumball_admin == gumball_admin.key() @ConfigStateErrors::InvalidGumballAdmin
    )]
    pub gumball_config: Box<Account<'info, GumballConfig>>,

    #[account(
        mut,
        seeds = [b"gumball", gumball_id.to_le_bytes().as_ref()],
        bump = gumball.gumball_bump,
        constraint = gumball.gumball_id == gumball_id @ GumballStateErrors::InvalidGumballId
    )]
    pub gumball: Box<Account<'info, GumballMachine>>,

    #[account(mut)]
    pub gumball_admin: Signer<'info>,

    #[account(
        mut,
        constraint = gumball.creator == creator.key() @ GumballStateErrors::InvalidCreator
    )]
    pub creator: AccountInfo<'info>,

    pub ticket_mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub ticket_escrow: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub ticket_fee_escrow_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub creator_ticket_ata: InterfaceAccount<'info, TokenAccount>,

    pub ticket_token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}
