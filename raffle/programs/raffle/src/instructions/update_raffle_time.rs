use crate::errors::RaffleErrors;
use crate::states::{Raffle, RaffleConfig, RaffleState};
use anchor_lang::prelude::*;

pub fn update_raffle_time(
    ctx: Context<UpdateRaffleTime>,
    raffle_id: u32,
    new_start_time: i64,
    new_end_time: i64,
) -> Result<()> {
    let config = &ctx.accounts.raffle_config;
    let raffle = &mut ctx.accounts.raffle;
    let creator = &ctx.accounts.creator;

    // Identity & access
    require_eq!(raffle.raffle_id, raffle_id, RaffleErrors::InvalidRaffleId);
    require_keys_eq!(raffle.creator, creator.key(), RaffleErrors::InvalidCreator);

    // Only Initialized raffles
    require!(
        raffle.status == RaffleState::Initialized,
        RaffleErrors::InvalidRaffleStateForUpdate
    );

    let now = Clock::get()?.unix_timestamp;

    // Raffle must not have started yet
    require!(now < raffle.start_time, RaffleErrors::RaffleAlreadyStarted);

    // New times must be in the future window
    require_gte!(new_start_time, now, RaffleErrors::StartTimeInPast);
    require_gt!(
        new_end_time,
        new_start_time,
        RaffleErrors::StartTimeExceedEndTime
    );

    let duration = new_end_time
        .checked_sub(new_start_time)
        .ok_or(RaffleErrors::StartTimeExceedEndTime)?;

    require!(
        duration >= config.minimum_raffle_period as i64
            && duration <= config.maximum_raffle_period as i64,
        RaffleErrors::InvalidRafflePeriod
    );

    raffle.start_time = new_start_time;
    raffle.end_time = new_end_time;

    Ok(())
}

#[derive(Accounts)]
#[instruction(raffle_id: u32)]
pub struct UpdateRaffleTime<'info> {
    #[account(
        seeds = [b"raffle"],
        bump = raffle_config.config_bump,
        constraint = raffle_config.raffle_admin == raffle_admin.key() @ RaffleErrors::InvalidRaffleAdmin,
    )]
    pub raffle_config: Box<Account<'info, RaffleConfig>>,

    #[account(
        mut,
        seeds = [b"raffle", raffle_id.to_le_bytes().as_ref()],
        bump = raffle.raffle_bump,
    )]
    pub raffle: Box<Account<'info, Raffle>>,

    #[account(
        mut,
        constraint = raffle.creator == creator.key() @ RaffleErrors::InvalidCreator,
    )]
    pub creator: Signer<'info>,

    #[account(mut)]
    pub raffle_admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}
