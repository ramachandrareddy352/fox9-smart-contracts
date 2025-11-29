use anchor_lang::prelude::*;
use crate::constants::*;
use crate::errors::{ConfigStateErrors, GumballStateErrors};
use crate::states::*;
use crate::utils::*;

#[event]
pub struct GumballTimeUpdated {
    pub gumball_id: u32,
    pub new_start_time: i64,
    pub new_end_time: i64,
    pub updated_at: i64,
}

#[event]
pub struct GumballDataUpdated {
    pub gumball_id: u32,
    pub new_ticket_price: u64,
    pub new_total_tickets: u16,
    pub updated_at: i64,
}

pub fn update_gumball_time(
    ctx: Context<UpdateGumball>,
    gumball_id: u32,
    mut new_start_time: i64,
    new_end_time: i64,
    start_gumball: bool,
) -> Result<()> {
    let config = &ctx.accounts.gumball_config;
    let gumball = &mut ctx.accounts.gumball;

    require!(
        !is_paused(config.pause_flags, UPDATE_GUMBALL_PAUSE),
        GumballStateErrors::FunctionPaused
    );

    let now = Clock::get()?.unix_timestamp;

    // Must be initialized
    require!(
        gumball.status == GumballState::Initialized,
        GumballStateErrors::InvalidGumballState
    );

    if start_gumball {
        new_start_time = now;
    }

    // Must be before start time
    require_gt!(
        gumball.start_time,
        now,
        GumballStateErrors::StartTimeNotReached
    );

    // New start must be >= now
    require_gte!(new_start_time, now, GumballStateErrors::StartTimeInPast);

    // Must satisfy duration rules
    let duration = new_end_time
        .checked_sub(new_start_time)
        .ok_or(GumballStateErrors::Overflow)?;

    require!(
        duration >= config.minimum_gumball_period as i64
            && duration <= config.maximum_gumball_period as i64,
        ConfigStateErrors::InvalidGumballPeriod
    );

    // Update states
    gumball.start_time = new_start_time;
    gumball.end_time = new_end_time;

    emit!(GumballTimeUpdated {
        gumball_id,
        new_start_time,
        new_end_time,
        updated_at: now,
    });

    Ok(())
}

pub fn update_gumball_data(
    ctx: Context<UpdateGumball>,
    gumball_id: u32,
    new_ticket_price: u64,
    new_total_tickets: u16,
) -> Result<()> {
    require!(
        !is_paused(
            ctx.accounts.gumball_config.pause_flags,
            UPDATE_GUMBALL_PAUSE
        ),
        GumballStateErrors::FunctionPaused
    );

    let gumball = &mut ctx.accounts.gumball;
    let now = Clock::get()?.unix_timestamp;

    // Must have no ticket sold
    require_eq!(
        gumball.tickets_sold,
        0,
        GumballStateErrors::TicketsAlreadySold
    );

    // Must be Initialized OR Active
    require!(
        gumball.status == GumballState::Initialized || gumball.status == GumballState::Active,
        GumballStateErrors::InvalidGumballState
    );

    // Update ticket price
    require_gt!(new_ticket_price, 0, GumballStateErrors::InvalidTicketPrice);
    require!(
        new_total_tickets >= gumball.prizes_added,
        GumballStateErrors::PrizesExceedTickets
    );

    // update states
    gumball.ticket_price = new_ticket_price;
    gumball.total_tickets = new_total_tickets;

    emit!(GumballDataUpdated {
        gumball_id,
        new_ticket_price,
        new_total_tickets,
        updated_at: now,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(gumball_id: u32)]
pub struct UpdateGumball<'info> {
    #[account(
        seeds = [b"gumball"],
        bump = gumball_config.config_bump,
        constraint = gumball_admin.key() == gumball_config.gumball_admin @ ConfigStateErrors::InvalidGumballAdmin,
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
        constraint = creator.key() == gumball.creator @ GumballStateErrors::InvalidCreator
    )]
    pub creator: Signer<'info>,

    pub gumball_admin: Signer<'info>,
}
