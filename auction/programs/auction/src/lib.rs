pub mod constants;
pub mod errors;
pub mod helpers;
pub mod instructions;
pub mod states;
pub mod utils;

use {anchor_lang::prelude::*, instructions::*};

declare_id!("HDW5Huoqz7Us3yiMgxAEkekHUfGvggUPLEz7WZ8uSTBY");

/// Sysvar for token mint and ATA creation
// pub rent: Sysvar<'info, Rent>,

#[program]
pub mod auction {
    use super::*;

    // Config
    pub fn initialize_auction_config(
        ctx: Context<InitializeAuctionConfig>,
        auction_owner: Pubkey,
        auction_admin: Pubkey,
        creation_fee_lamports: u64,
        commission_bps: u16,
        minimum_auction_period: u32,
        maximum_auction_period: u32,
        minimum_time_extension: u32,
        maximum_time_extension: u32,
    ) -> Result<()> {
        process_auction_config::initialize_auction_config(
            ctx,
            auction_owner,
            auction_admin,
            creation_fee_lamports,
            commission_bps,
            minimum_auction_period,
            maximum_auction_period,
            minimum_time_extension,
            maximum_time_extension,
        )
    }

    pub fn update_auction_owner(
        ctx: Context<UpdateAuctionConfig>,
        new_auction_owner: Pubkey,
    ) -> Result<()> {
        process_auction_config::update_auction_owner(ctx, new_auction_owner)
    }

    pub fn update_auction_admin(
        ctx: Context<UpdateAuctionConfig>,
        new_auction_admin: Pubkey,
    ) -> Result<()> {
        process_auction_config::update_auction_admin(ctx, new_auction_admin)
    }

    pub fn update_pause_and_unpause(
        ctx: Context<UpdateAuctionConfig>,
        new_pause_flags: u8,
    ) -> Result<()> {
        process_auction_config::update_pause_and_unpause(ctx, new_pause_flags)
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
        process_auction_config::update_config_data(
            ctx,
            creation_fee_lamports,
            commission_bps,
            minimum_auction_period,
            maximum_auction_period,
            minimum_time_extension,
            maximum_time_extension,
        )
    }

    pub fn create_auction(
        ctx: Context<CreateAuction>,
        start_time: i64,
        end_time: i64,
        start_immediately: bool,
        is_bid_mint_sol: bool,
        base_bid: u64, // base bid can be zero also
        min_increment: u64,
        time_extension: u32,
    ) -> Result<()> {
        create_auction::create_auction(
            ctx,
            start_time,
            end_time,
            start_immediately,
            is_bid_mint_sol,
            base_bid,
            min_increment,
            time_extension,
        )
    }

    pub fn start_auction(ctx: Context<StartAuction>, auction_id: u32) -> Result<()> {
        start_auction::start_auction(ctx, auction_id)
    }

    pub fn update_auction(
        ctx: Context<UpdateAuction>,
        auction_id: u32,
        start_time: i64,
        end_time: i64,
        start_immediately: bool, // If true, set start_time = now (but we still require status==Initialized & no bids)
        base_bid: u64,
        min_increment: u64,
        time_extension: u32,
    ) -> Result<()> {
        update_auction::update_auction(
            ctx,
            auction_id,
            start_time,
            end_time,
            start_immediately,
            base_bid,
            min_increment,
            time_extension,
        )
    }

    pub fn cancel_auction(ctx: Context<CancelAuction>, auction_id: u32) -> Result<()> {
        cancel_auction::cancel_auction(ctx, auction_id)
    }

    pub fn place_bid(ctx: Context<PlaceBid>, auction_id: u32, bid_amount: u64) -> Result<()> {
        place_bid::place_bid(ctx, auction_id, bid_amount)
    }

    pub fn complete_auction(ctx: Context<CompleteAuction>, auction_id: u32) -> Result<()> {
        complete_auction::complete_auction(ctx, auction_id)
    }

    pub fn withdraw_sol_fees(ctx: Context<WithdrawSolFees>, amount: u64) -> Result<()> {
        withdraw_sol_fees::withdraw_sol_fees(ctx, amount)
    }

    pub fn withdraw_spl_fees(ctx: Context<WithdrawSplFees>, amount: u64) -> Result<()> {
        withdraw_spl_fees::withdraw_spl_fees(ctx, amount)
    }
}
