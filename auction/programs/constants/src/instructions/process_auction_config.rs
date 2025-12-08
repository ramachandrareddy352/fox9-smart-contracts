use anchor_lang::prelude::*;
use crate::errors::ConfigStateErrors;
use crate::states::AuctionConfig;

pub fn initialize_auction_config(
    ctx: Context<InitializeAuctionConfig>,
    auction_owner: Pubkey,
    auction_admin: Pubkey,
    creation_fee_lamports: u64,
    commission_bps: u16,
    minimum_auction_period: u32,
    maximum_auction_period: u32,
    minimum_time_extension: u32, // minimum extension period can be zero also
    maximum_time_extension: u32,
) -> Result<()> {
    require!(
        minimum_auction_period > 0 && maximum_auction_period > minimum_auction_period,
        ConfigStateErrors::InvalidAuctionPeriod
    );
    require_gt!(
        maximum_time_extension,
        minimum_time_extension,
        ConfigStateErrors::InvalidTimeExtension
    );

    let cfg = &mut ctx.accounts.auction_config;
    cfg.auction_owner = auction_owner;
    cfg.auction_admin = auction_admin;
    cfg.creation_fee_lamports = creation_fee_lamports;
    cfg.commission_bps = commission_bps;
    cfg.minimum_auction_period = minimum_auction_period;
    cfg.maximum_auction_period = maximum_auction_period;
    cfg.minimum_time_extension = minimum_time_extension;
    cfg.maximum_time_extension = maximum_time_extension;
    cfg.auction_count = 1;
    cfg.config_bump = ctx.bumps.auction_config;

    Ok(())
}

pub fn update_auction_owner(
    ctx: Context<UpdateAuctionConfig>,
    new_auction_owner: Pubkey,
) -> Result<()> {
    let cfg = &mut ctx.accounts.auction_config;

    cfg.auction_owner = new_auction_owner;

    Ok(())
}

pub fn update_auction_admin(
    ctx: Context<UpdateAuctionConfig>,
    new_auction_admin: Pubkey,
) -> Result<()> {
    let cfg = &mut ctx.accounts.auction_config;

    cfg.auction_admin = new_auction_admin;

    Ok(())
}

pub fn update_config_data(
    ctx: Context<UpdateAuctionConfig>,
    creation_fee_lamports: u64,
    commission_bps: u16,
    minimum_auction_period: u32,
    maximum_auction_period: u32,
    minimum_time_extension: u32,
    maximum_time_extension: u32,
) -> Result<()> {
    require!(
        minimum_auction_period > 0 && maximum_auction_period > minimum_auction_period,
        ConfigStateErrors::InvalidAuctionPeriod
    );
    require_gt!(
        maximum_time_extension,
        minimum_time_extension,
        ConfigStateErrors::InvalidTimeExtension
    );

    let cfg = &mut ctx.accounts.auction_config;

    cfg.creation_fee_lamports = creation_fee_lamports;
    cfg.commission_bps = commission_bps;
    cfg.minimum_auction_period = minimum_auction_period;
    cfg.maximum_auction_period = maximum_auction_period;
    cfg.minimum_time_extension = minimum_time_extension;
    cfg.maximum_time_extension = maximum_time_extension;

    Ok(())
}

pub fn update_pause_and_unpause(
    ctx: Context<UpdateAuctionConfig>,
    new_pause_flags: u8,
) -> Result<()> {
    let cfg = &mut ctx.accounts.auction_config;

    cfg.pause_flags = new_pause_flags;

    Ok(())
}

#[derive(Accounts)]
pub struct InitializeAuctionConfig<'info> {
    #[account(
        init, 
        payer = payer, 
        space = 8 + AuctionConfig::INIT_SPACE, 
        seeds = [b"auction"], 
        bump
    )]
    pub auction_config: Box<Account<'info, AuctionConfig>>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateAuctionConfig<'info> {
    #[account(
        mut, 
        seeds = [b"auction"], 
        bump = auction_config.config_bump, 
        constraint = auction_owner.key() == auction_config.auction_owner @ConfigStateErrors::InvalidAuctionOwner
    )]
    pub auction_config: Box<Account<'info, AuctionConfig>>,

    #[account(mut)]
    pub auction_owner: Signer<'info>,
}
