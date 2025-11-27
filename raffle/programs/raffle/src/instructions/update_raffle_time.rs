use anchor_lang::prelude::*;
use crate::constants::UPDATE_RAFFLE_PAUSE;
use crate::errors::{ConfigStateErrors, RaffleStateErrors};
use crate::states::{Raffle, RaffleConfig, RaffleState};
use crate::utils::is_paused;

#[event]
pub struct RaffleTimeUpdated {
    pub raffle_id: u32,
    pub new_start_time: i64,
    pub new_end_time: i64,
    pub updated_time: i64,
}

pub fn update_raffle_time(
    ctx: Context<UpdateRaffleTime>,
    _raffle_id: u32,
    new_start_time: i64,
    new_end_time: i64,
) -> Result<()> {
    let config = &ctx.accounts.raffle_config;
    let raffle = &mut ctx.accounts.raffle;

    require!(
        !is_paused(config.pause_flags, UPDATE_RAFFLE_PAUSE),
        RaffleStateErrors::FunctionPaused
    );

    // Only Initialized raffles
    require!(
        raffle.status == RaffleState::Initialized,
        RaffleStateErrors::InvalidRaffleStateForUpdate
    );

    let now = Clock::get()?.unix_timestamp;

    // Raffle must not have started yet
    require_gt!(
        raffle.start_time,
        now,
        RaffleStateErrors::RaffleAlreadyStarted
    );

    // New times must be in the future window
    require_gt!(new_start_time, now, RaffleStateErrors::StartTimeInPast);

    let duration = new_end_time
        .checked_sub(new_start_time)
        .ok_or(RaffleStateErrors::StartTimeExceedEndTime)?;

    require!(
        duration >= config.minimum_raffle_period as i64
            && duration <= config.maximum_raffle_period as i64,
        ConfigStateErrors::InvalidRafflePeriod
    );

    raffle.start_time = new_start_time;
    raffle.end_time = new_end_time;

    emit!(RaffleTimeUpdated {
        raffle_id: raffle.raffle_id,
        new_start_time,
        new_end_time,
        updated_time: now,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(raffle_id: u32)]
pub struct UpdateRaffleTime<'info> {
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
        constraint = raffle.raffle_id == raffle_id @ RaffleStateErrors::InvalidRaffleId,
    )]
    pub raffle: Box<Account<'info, Raffle>>,

    #[account(
        mut,
        constraint = raffle.creator == creator.key() @ RaffleStateErrors::InvalidCreator,
    )]
    pub creator: Signer<'info>,

    pub raffle_admin: Signer<'info>,
}
