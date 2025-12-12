use anchor_lang::prelude::*;
use crate::constants::*;
use crate::errors::{ConfigStateErrors, GumballStateErrors};
use crate::states::{GumballConfig, GumballMachine, GumballState};
use crate::utils::is_paused;

#[event]
pub struct GumballActivated {
    pub gumball_id: u32,
    pub activated_at: i64,
}

pub fn activate_gumball(ctx: Context<ActivateGumball>, _gumball_id: u32) -> Result<()> {
    let gumball = &mut ctx.accounts.gumball;

    // ensure the activate function is not paused in config
    require!(
        !is_paused(
            ctx.accounts.gumball_config.pause_flags,
            ACTIVATE_GUMBALL_PAUSE
        ),
        GumballStateErrors::FunctionPaused
    );

    // current state checks
    require!(
        gumball.status == GumballState::Initialized,
        GumballStateErrors::NotInitialized
    );

    // Time validation - activation allowed only after start_time is reached
    let now = Clock::get()?.unix_timestamp;
    require_gte!(
        now,
        gumball.start_time,
        GumballStateErrors::StartTimeNotReached
    );

    // Update gumball status to Active
    gumball.status = GumballState::Active;

    emit!(GumballActivated {
        gumball_id: gumball.gumball_id,
        activated_at: now,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(gumball_id: u32)]
pub struct ActivateGumball<'info> {
    #[account(
        seeds = [b"gumball"],
        bump = gumball_config.config_bump,
        constraint = gumball_config.gumball_admin == gumball_admin.key() @ ConfigStateErrors::InvalidGumballAdmin,
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
}
