use crate::errors::RaffleErrors;
use crate::states::RaffleConfig;
use anchor_lang::prelude::*;

pub fn initialize_raffle_config(
    ctx: Context<InitializeRaffleConfig>,
    raffle_owner: Pubkey,
    raffle_admin: Pubkey,
    creation_fee_lamports: u64,
    ticket_fee_bps: u16,
    minimum_raffle_period: u32,
    maximum_raffle_period: u32,
    minimum_tickets: u16,
    maximum_tickets: u16,
    maximum_winners_count: u8,
) -> Result<()> {
    require!(
        minimum_raffle_period > 0 && maximum_raffle_period > minimum_raffle_period,
        RaffleErrors::InvalidRafflePeriod
    );
    let raffle_config = &mut ctx.accounts.raffle_config;

    raffle_config.raffle_owner = raffle_owner;
    raffle_config.raffle_admin = raffle_admin;
    raffle_config.creation_fee_lamports = creation_fee_lamports;
    raffle_config.ticket_fee_bps = ticket_fee_bps;
    raffle_config.minimum_raffle_period = minimum_raffle_period;
    raffle_config.maximum_raffle_period = maximum_raffle_period;
    raffle_config.minimum_tickets = minimum_tickets;
    raffle_config.maximum_tickets = maximum_tickets;
    raffle_config.maximum_winners_count = maximum_winners_count;
    raffle_config.raffle_count = 1;
    raffle_config.config_bump = ctx.bumps.raffle_config;

    Ok(())
}

pub fn update_raffle_config_owner(
    ctx: Context<UpdateRaffleConfig>,
    new_raffle_owner: Pubkey,
) -> Result<()> {
    let raffle_config = &mut ctx.accounts.raffle_config;
    raffle_config.raffle_owner = new_raffle_owner;
    Ok(())
}

pub fn update_raffle_config_admin(
    ctx: Context<UpdateRaffleConfig>,
    new_raffle_admin: Pubkey,
) -> Result<()> {
    let raffle_config = &mut ctx.accounts.raffle_config;
    raffle_config.raffle_admin = new_raffle_admin;
    Ok(())
}

pub fn update_raffle_config_data(
    ctx: Context<UpdateRaffleConfig>,
    creation_fee_lamports: u64,
    ticket_fee_bps: u16,
    minimum_raffle_period: u32,
    maximum_raffle_period: u32,
    minimum_tickets: u16,
    maximum_tickets: u16,
    maximum_winners_count: u8,
) -> Result<()> {
    require!(
        minimum_raffle_period > 0 && maximum_raffle_period > minimum_raffle_period,
        RaffleErrors::InvalidRafflePeriod
    );

    let raffle_config = &mut ctx.accounts.raffle_config;

    raffle_config.creation_fee_lamports = creation_fee_lamports;
    raffle_config.ticket_fee_bps = ticket_fee_bps;
    raffle_config.minimum_raffle_period = minimum_raffle_period;
    raffle_config.maximum_raffle_period = maximum_raffle_period;
    raffle_config.minimum_tickets = minimum_tickets;
    raffle_config.maximum_tickets = maximum_tickets;
    raffle_config.maximum_winners_count = maximum_winners_count;

    Ok(())
}

#[derive(Accounts)]
pub struct InitializeRaffleConfig<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + RaffleConfig::INIT_SPACE,
        seeds = [b"raffle"],
        bump
    )]
    pub raffle_config: Box<Account<'info, RaffleConfig>>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateRaffleConfig<'info> {
    #[account(
        mut,
        seeds = [b"raffle"],
        raffle_config.config_bump,
        constraint =  raffle_owner.key() == raffle_config.raffle_owner @Errors::InvalidRaffleOwner

    )]
    pub raffle_config: Box<Account<'info, RaffleConfig>>,

    #[account(mut)]
    pub raffle_owner: Signer<'info>,

    pub system_program: Program<'info, System>,
}
