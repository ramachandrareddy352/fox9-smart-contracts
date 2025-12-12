pub mod constants;
pub mod errors;
pub mod helpers;
pub mod instructions;
pub mod states;
pub mod utils;

use {anchor_lang::prelude::*, instructions::*};

declare_id!("6WjtxBErVmFVqndkV3J79rQ7qgBtwxcdSbBjMKHfUrGE");

#[program]
pub mod gumball {
    use super::*;

    pub fn initialize_gumball_config(
        ctx: Context<InitializeGumballConfig>,
        gumball_owner: Pubkey,
        gumball_admin: Pubkey,
        creation_fee_lamports: u64,
        ticket_fee_bps: u16,
        minimum_gumball_period: u32,
        maximum_gumball_period: u32,
    ) -> Result<()> {
        process_gumball_config::initialize_gumball_config(
            ctx,
            gumball_owner,
            gumball_admin,
            creation_fee_lamports,
            ticket_fee_bps,
            minimum_gumball_period,
            maximum_gumball_period,
        )
    }

    pub fn update_gumball_owner(
        ctx: Context<UpdateGumballConfig>,
        new_owner: Pubkey,
    ) -> Result<()> {
        process_gumball_config::update_gumball_owner(ctx, new_owner)
    }

    pub fn update_gumball_admin(
        ctx: Context<UpdateGumballConfig>,
        new_admin: Pubkey,
    ) -> Result<()> {
        process_gumball_config::update_gumball_admin(ctx, new_admin)
    }

    pub fn update_pause_flags(
        ctx: Context<UpdateGumballConfig>,
        new_pause_flags: u8,
    ) -> Result<()> {
        process_gumball_config::update_pause_flags(ctx, new_pause_flags)
    }

    pub fn update_gumball_config_data(
        ctx: Context<UpdateGumballConfig>,
        creation_fee_lamports: u64,
        ticket_fee_bps: u16,
        minimum_gumball_period: u32,
        maximum_gumball_period: u32,
    ) -> Result<()> {
        process_gumball_config::update_gumball_config_data(
            ctx,
            creation_fee_lamports,
            ticket_fee_bps,
            minimum_gumball_period,
            maximum_gumball_period,
        )
    }

    pub fn create_gumball(
        ctx: Context<CreateGumball>,
        start_time: i64,
        end_time: i64,
        total_tickets: u16,
        ticket_price: u64,
        is_ticket_sol: bool,
        start_gumball: bool,
    ) -> Result<()> {
        create_gumball::create_gumball(
            ctx,
            start_time,
            end_time,
            total_tickets,
            ticket_price,
            is_ticket_sol,
            start_gumball,
        )
    }

    pub fn activate_gumball(ctx: Context<ActivateGumball>, gumball_id: u32) -> Result<()> {
        activate_gumball::activate_gumball(ctx, gumball_id)
    }

    pub fn add_prize(
        ctx: Context<AddPrize>,
        gumball_id: u32,
        prize_index: u16,
        prize_amount: u64,
        quantity: u16,
    ) -> Result<()> {
        add_prize::add_prize(ctx, gumball_id, prize_index, prize_amount, quantity)
    }

    pub fn cancel_gumball(ctx: Context<CancelGumball>, gumball_id: u32) -> Result<()> {
        cancel_gumball::cancel_gumball(ctx, gumball_id)
    }

    pub fn end_gumball(ctx: Context<EndGumball>, gumball_id: u32) -> Result<()> {
        end_gumball::end_gumball(ctx, gumball_id)
    }

    pub fn update_gumball_time(
        ctx: Context<UpdateGumball>,
        gumball_id: u32,
        new_start_time: i64,
        new_end_time: i64,
        start_gumball: bool,
    ) -> Result<()> {
        update_gumball::update_gumball_time(
            ctx,
            gumball_id,
            new_start_time,
            new_end_time,
            start_gumball,
        )
    }

    pub fn update_gumball_data(
        ctx: Context<UpdateGumball>,
        gumball_id: u32,
        new_ticket_price: u64,
        new_total_tickets: u16,
    ) -> Result<()> {
        update_gumball::update_gumball_data(ctx, gumball_id, new_ticket_price, new_total_tickets)
    }

    pub fn spin_gumball(
        ctx: Context<SpinGumball>,
        gumball_id: u32,
        prize_index: u16,
    ) -> Result<()> {
        spin_gumball::spin_gumball(ctx, gumball_id, prize_index)
    }

    pub fn claim_prize_back(
        ctx: Context<ClaimPrizeBack>,
        gumball_id: u32,
        prize_index: u16,
    ) -> Result<()> {
        claim_prize_back::claim_prize_back(ctx, gumball_id, prize_index)
    }

    pub fn withdraw_sol_fees(ctx: Context<WithdrawSolFees>, amount: u64) -> Result<()> {
        withdraw_sol_fees::withdraw_sol_fees(ctx, amount)
    }

    pub fn withdraw_spl_fees(ctx: Context<WithdrawSplFees>, amount: u64) -> Result<()> {
        withdraw_spl_fees::withdraw_spl_fees(ctx, amount)
    }
}
