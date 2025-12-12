use anchor_lang::prelude::*;
use crate::errors::ConfigStateErrors;
use crate::states::GumballConfig;

pub fn initialize_gumball_config(
    ctx: Context<InitializeGumballConfig>,
    gumball_owner: Pubkey,
    gumball_admin: Pubkey,
    creation_fee_lamports: u64,
    ticket_fee_bps: u16,         // 100 = 1%
    minimum_gumball_period: u32, // must be > 0
    maximum_gumball_period: u32, // must be > minimum
) -> Result<()> {
    require!(
        minimum_gumball_period > 0 && maximum_gumball_period > minimum_gumball_period,
        ConfigStateErrors::InvalidGumballPeriod
    );

    let cfg = &mut ctx.accounts.gumball_config;

    cfg.gumball_owner = gumball_owner;
    cfg.gumball_admin = gumball_admin;
    cfg.creation_fee_lamports = creation_fee_lamports;
    cfg.ticket_fee_bps = ticket_fee_bps;
    cfg.minimum_gumball_period = minimum_gumball_period;
    cfg.maximum_gumball_period = maximum_gumball_period;
    cfg.gumball_count = 1; // first gumball id will be 1
    cfg.config_bump = ctx.bumps.gumball_config;

    Ok(())
}

pub fn update_gumball_owner(ctx: Context<UpdateGumballConfig>, new_owner: Pubkey) -> Result<()> {
    let cfg = &mut ctx.accounts.gumball_config;

    cfg.gumball_owner = new_owner;

    Ok(())
}

pub fn update_gumball_admin(ctx: Context<UpdateGumballConfig>, new_admin: Pubkey) -> Result<()> {
    let cfg = &mut ctx.accounts.gumball_config;

    cfg.gumball_admin = new_admin;
    
    Ok(())
}

pub fn update_gumball_config_data(
    ctx: Context<UpdateGumballConfig>,
    creation_fee_lamports: u64,
    ticket_fee_bps: u16,
    minimum_gumball_period: u32,
    maximum_gumball_period: u32,
) -> Result<()> {
    require!(
        minimum_gumball_period > 0 && maximum_gumball_period > minimum_gumball_period,
        ConfigStateErrors::InvalidGumballPeriod
    );

    let cfg = &mut ctx.accounts.gumball_config;

    cfg.creation_fee_lamports = creation_fee_lamports;
    cfg.ticket_fee_bps = ticket_fee_bps;
    cfg.minimum_gumball_period = minimum_gumball_period;
    cfg.maximum_gumball_period = maximum_gumball_period;

    Ok(())
}

pub fn update_pause_flags(ctx: Context<UpdateGumballConfig>, new_pause_flags: u8) -> Result<()> {
    let cfg = &mut ctx.accounts.gumball_config;

    cfg.pause_flags = new_pause_flags;

    Ok(())
}

#[derive(Accounts)]
pub struct InitializeGumballConfig<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + GumballConfig::INIT_SPACE,
        seeds = [b"gumball"],
        bump
    )]
    pub gumball_config: Box<Account<'info, GumballConfig>>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateGumballConfig<'info> {
    #[account(
        mut,
        seeds = [b"gumball"],
        bump = gumball_config.config_bump,
        constraint = gumball_owner.key() == gumball_config.gumball_owner @ ConfigStateErrors::InvalidGumballOwner
    )]
    pub gumball_config: Box<Account<'info, GumballConfig>>,

    #[account(mut)]
    pub gumball_owner: Signer<'info>,
}
