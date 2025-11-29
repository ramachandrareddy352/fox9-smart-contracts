use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount};
use crate::constants::*;
use crate::errors::{ConfigStateErrors, GumballStateErrors, KeysMismatchErrors};
use crate::helpers::*;
use crate::states::*;
use crate::utils::is_paused;

#[event]
pub struct GumballCreated {
    pub gumball_id: u32,
    pub creator: Pubkey,
    pub start_time: i64,
    pub end_time: i64,
    pub created_at: i64,
}

pub fn create_gumball(
    ctx: Context<CreateGumball>,
    mut start_time: i64,
    end_time: i64,
    total_tickets: u16,
    ticket_price: u64,
    is_ticket_sol: bool,
    start_gumball: bool,
) -> Result<()> {
    let config = &mut ctx.accounts.gumball_config;

    require!(
        !is_paused(config.pause_flags, CREATE_GUMBALL_PAUSE),
        GumballStateErrors::FunctionPaused
    );

    let gumball = &mut ctx.accounts.gumball;
    let creator = &ctx.accounts.creator;
    let now = Clock::get()?.unix_timestamp;

    // Basic validations
    require_gt!(ticket_price, 0, GumballStateErrors::InvalidTicketPrice);
    require!(
        MINIMUM_TICKETS <= total_tickets && total_tickets <= MAXIMUM_TICKETS,
        GumballStateErrors::InvalidTotalTickets
    );

    // Time validation
    if start_gumball {
        start_time = now;
    }
    let duration = end_time
        .checked_sub(start_time)
        .ok_or(GumballStateErrors::StartTimeExceedEndTime)?;

    require_gte!(start_time, now, GumballStateErrors::StartTimeInPast);
    require!(
        duration >= config.minimum_gumball_period as i64
            && duration <= config.maximum_gumball_period as i64,
        ConfigStateErrors::InvalidGumballPeriod
    );

    // Set gumball metadata
    gumball.gumball_id = config.gumball_count;
    gumball.creator = creator.key();
    gumball.start_time = start_time;
    gumball.end_time = end_time;
    gumball.total_tickets = total_tickets;
    gumball.ticket_price = ticket_price;
    gumball.status = if start_gumball {
        GumballState::Active
    } else {
        GumballState::Initialized
    };
    gumball.gumball_bump = ctx.bumps.gumball;

    // Ticket escrow (only if SPL tickets)
    if !is_ticket_sol {
        let ticket_mint = &ctx.accounts.ticket_mint;
        let ticket_mint_key = ticket_mint.key();

        let ticket_escrow = &ctx.accounts.ticket_escrow;
        require_keys_eq!(
            ticket_escrow.owner,
            gumball.key(),
            KeysMismatchErrors::InvalidTicketEscrowOwner
        );
        require_keys_eq!(
            ticket_escrow.mint,
            ticket_mint_key,
            KeysMismatchErrors::InvalidTicketMint
        );

        gumball.ticket_mint = Some(ticket_mint_key);
    } else {
        gumball.ticket_mint = None;
    }

    // Charge creation fee (in lamports) to config account if configured
    if config.creation_fee_lamports > 0 {
        transfer_sol(
            creator,
            &config.to_account_info(),
            &ctx.accounts.system_program,
            config.creation_fee_lamports,
        )?;
    }

    // Increment global gumball counter
    config.gumball_count = config
        .gumball_count
        .checked_add(1)
        .ok_or(GumballStateErrors::Overflow)?;

    emit!(GumballCreated {
        gumball_id: gumball.gumball_id,
        creator: creator.key(),
        start_time: gumball.start_time,
        end_time: gumball.end_time,
        created_at: now,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct CreateGumball<'info> {
    #[account(
        mut,
        seeds = [b"gumball"],
        bump = gumball_config.config_bump,
        constraint = gumball_admin.key() == gumball_config.gumball_admin @ ConfigStateErrors::InvalidGumballAdmin,
    )]
    pub gumball_config: Box<Account<'info, GumballConfig>>,

    #[account(
        init,
        payer = creator,
        space = 8 + GumballMachine::INIT_SPACE,
        seeds = [b"gumball", gumball_config.gumball_count.to_le_bytes().as_ref()],
        bump
    )]
    pub gumball: Box<Account<'info, GumballMachine>>,

    #[account(mut)]
    pub creator: Signer<'info>,

    pub gumball_admin: Signer<'info>,

    // Mint used for tickets (must be a valid SPL mint if `is_ticket_sol == false`)
    pub ticket_mint: InterfaceAccount<'info, Mint>,

    // Ticket escrow ATA (create ATA to store the tickets amount from the buyers and owner of the ATA is the gumball account, if ticket mint != sol)
    #[account(mut)]
    pub ticket_escrow: InterfaceAccount<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
}
