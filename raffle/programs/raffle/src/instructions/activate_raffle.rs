use crate::errors::RaffleErrors;
use crate::states::{Raffle, RaffleConfig, RaffleState};
use anchor_lang::prelude::*;

pub fn activate_raffle(ctx: Context<ActivateRaffle>) -> Result<()> {
    let raffle = &mut ctx.accounts.raffle;

    // Must currently be in Initialized state
    require!(
        raffle.status == RaffleState::Initialized,
        RaffleErrors::InvalidRaffleStateTransition
    );

    // Time validation: activation allowed only at or after start_time
    let now = Clock::get()?.unix_timestamp;
    require_gte!(now, raffle.start_time, RaffleErrors::StartTimeNotReached);

    // Update raffle status to Active
    raffle.status = RaffleState::Active;

    // Emit event
    emit!(RaffleActivated {
        raffle_id: raffle.raffle_id,
        activated_at: now,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct ActivateRaffle<'info> {
    #[account(
        seeds = [b"raffle"],
        bump = raffle_config.config_bump,
        constraint = raffle_config.raffle_admin == raffle_admin.key() @ RaffleErrors::InvalidRaffleAdmin,
    )]
    pub raffle_config: Box<Account<'info, RaffleConfig>>,

    #[account(
        mut,
        seeds = [b"raffle", raffle.raffle_id.to_le_bytes().as_ref()],
        bump = raffle.raffle_bump,
    )]
    pub raffle: Box<Account<'info, Raffle>>,

    #[account(mut)]
    pub raffle_admin: Signer<'info>,
}
