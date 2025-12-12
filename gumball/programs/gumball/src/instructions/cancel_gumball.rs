use anchor_lang::prelude::*;
use crate::constants::*;
use crate::errors::{ConfigStateErrors, GumballStateErrors};
use crate::states::*;
use crate::utils::is_paused;

#[event]
pub struct GumballCancelled {
    pub gumball_id: u32,
    pub cancelled_by: Pubkey,
    pub cancelled_at: i64,
}

pub fn cancel_gumball(ctx: Context<CancelGumball>, gumball_id: u32) -> Result<()> {
    let gumball = &mut ctx.accounts.gumball;

    // Check PAUSE flag
    require!(
        !is_paused(
            ctx.accounts.gumball_config.pause_flags,
            CANCEL_GUMBALL_PAUSE
        ),
        GumballStateErrors::FunctionPaused
    );

    // Cannot cancel if tickets sold
    require_eq!(
        gumball.tickets_sold,
        0u16,
        GumballStateErrors::TicketsAlreadySold
    );

    // Must be in Initialized or Active
    require!(
        gumball.status == GumballState::Initialized || gumball.status == GumballState::Active,
        GumballStateErrors::InvalidGumballState
    );

    // update the gumball
    gumball.status = GumballState::Cancelled;

    // Emit event
    emit!(GumballCancelled {
        gumball_id,
        cancelled_by: ctx.accounts.creator.key(),
        cancelled_at: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(gumball_id: u32)]
pub struct CancelGumball<'info> {
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
