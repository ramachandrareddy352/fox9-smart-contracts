use anchor_lang::prelude::*;
use crate::constants::*;
use crate::errors::{ConfigStateErrors, RaffleStateErrors};
use crate::states::{Raffle, RaffleConfig, RaffleState};
use crate::utils::is_paused;

#[event]
pub struct RaffleActivated {
    raffle_id: u32,
    activated_at: i64,
}
 
pub fn activate_raffle(ctx: Context<ActivateRaffle>, _raffle_id: u32) -> Result<()> {
    let raffle = &mut ctx.accounts.raffle;

    require!(
        !is_paused(
            ctx.accounts.raffle_config.pause_flags,
            ACTIVATE_RAFFLE_PAUSE
        ),
        RaffleStateErrors::FunctionPaused
    );

    // current state checks
    require!(
        raffle.status == RaffleState::Initialized,
        RaffleStateErrors::StateShouldBeInInitialized
    );

    // Time validation
    let now = Clock::get()?.unix_timestamp;
    require_gt!(
        now,
        raffle.start_time,
        RaffleStateErrors::StartTimeNotReached
    );

    // Update raffle status to Active
    raffle.status = RaffleState::Active;

    emit!(RaffleActivated {
        raffle_id: raffle.raffle_id,
        activated_at: now,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(raffle_id: u32)]
pub struct ActivateRaffle<'info> {
    #[account(
        seeds = [b"raffle"],
        bump = raffle_config.config_bump,
        constraint = raffle_config.raffle_admin == raffle_admin.key() @ ConfigStateErrors::InvalidRaffleAdmin,
    )]
    pub raffle_config: Box<Account<'info, RaffleConfig>>,

    #[account(
        mut,
        seeds = [b"raffle", raffle_id.to_le_bytes().as_ref()],
        bump = raffle.raffle_bump,
        constraint = raffle.raffle_id == raffle_id @ RaffleStateErrors::InvalidRaffleId
    )]
    pub raffle: Box<Account<'info, Raffle>>,

    #[account(mut)]
    pub raffle_admin: Signer<'info>,
}
