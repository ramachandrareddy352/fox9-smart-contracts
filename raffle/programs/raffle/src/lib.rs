pub mod constants;
pub mod errors;
pub mod helpers;
pub mod instructions;
pub mod states;
pub mod utils;

use {anchor_lang::prelude::*, instructions::*, states::*};

declare_id!("4HY6XZvoKT8hBUST6Bssj9LZXbWK3RsUEW8qTbSHq4bS");

#[program]
pub mod raffle {
    use super::*;

    // Config
    pub fn initialize_raffle_config(
        ctx: Context<InitializeRaffleConfig>,
        raffle_owner: Pubkey,
        raffle_admin: Pubkey,
        creation_fee_lamports: u64,
        ticket_fee_bps: u16,
        minimum_raffle_period: u32,
        maximum_raffle_period: u32,
    ) -> Result<()> {
        process_raffle_config::initialize_raffle_config(
            ctx,
            raffle_owner,
            raffle_admin,
            creation_fee_lamports,
            ticket_fee_bps,
            minimum_raffle_period,
            maximum_raffle_period,
        )
    }

    pub fn update_raffle_config_owner(
        ctx: Context<UpdateRaffleConfig>,
        new_raffle_owner: Pubkey,
    ) -> Result<()> {
        process_raffle_config::update_raffle_config_owner(ctx, new_raffle_owner)
    }

    pub fn update_pause_and_unpause(
        ctx: Context<UpdateRaffleConfig>,
        new_pause_flags: u8,
    ) -> Result<()> {
        process_raffle_config::update_pause_and_unpause(ctx, new_pause_flags)
    }

    pub fn update_raffle_config_admin(
        ctx: Context<UpdateRaffleConfig>,
        new_raffle_admin: Pubkey,
    ) -> Result<()> {
        process_raffle_config::update_raffle_config_admin(ctx, new_raffle_admin)
    }

    pub fn update_raffle_config_data(
        ctx: Context<UpdateRaffleConfig>,
        creation_fee_lamports: u64,
        ticket_fee_bps: u16,
        minimum_raffle_period: u32,
        maximum_raffle_period: u32,
    ) -> Result<()> {
        process_raffle_config::update_raffle_config_data(
            ctx,
            creation_fee_lamports,
            ticket_fee_bps,
            minimum_raffle_period,
            maximum_raffle_period,
        )
    }

    pub fn create_raffle(
        ctx: Context<CreateRaffle>,
        start_time: i64,
        end_time: i64,
        total_tickets: u16,
        ticket_price: u64,
        is_ticket_sol: bool,
        max_per_wallet_pct: u8,
        prize_type: PrizeType,
        prize_amount: u64,
        num_winners: u8,
        win_shares: Vec<u8>,
        is_unique_winners: bool,
        start_raffle: bool,
    ) -> Result<()> {
        create_raffle::create_raffle(
            ctx,
            start_time,
            end_time,
            total_tickets,
            ticket_price,
            is_ticket_sol,
            max_per_wallet_pct,
            prize_type,
            prize_amount,
            num_winners,
            win_shares,
            is_unique_winners,
            start_raffle,
        )
    }

    pub fn activate_raffle(ctx: Context<ActivateRaffle>, raffle_id: u32) -> Result<()> {
        activate_raffle::activate_raffle(ctx, raffle_id)
    }

    pub fn announce_winners(
        ctx: Context<AnnounceWinners>,
        raffle_id: u32,
        winners: Vec<Pubkey>,
    ) -> Result<()> {
        announce_winners::announce_winners(ctx, raffle_id, winners)
    }

    pub fn buy_ticket(ctx: Context<BuyTicket>, raffle_id: u32, tickets_to_buy: u16) -> Result<()> {
        buy_ticket::buy_ticket(ctx, raffle_id, tickets_to_buy)
    }

    pub fn buyer_claim_prize(
        ctx: Context<BuyerClaimPrize>,
        raffle_id: u32,
        winner_index: u8,
    ) -> Result<()> {
        buyer_claim_prize::buyer_claim_prize(ctx, raffle_id, winner_index)
    }

    pub fn cancel_raffle(ctx: Context<CancelRaffle>, raffle_id: u32) -> Result<()> {
        cancel_raffle::cancel_raffle(ctx, raffle_id)
    }

    pub fn claim_amount_back(ctx: Context<ClaimAmountBack>, raffle_id: u32) -> Result<()> {
        claim_amount_back::claim_amount_back(ctx, raffle_id)
    }

    pub fn update_raffle_ticketing(
        ctx: Context<UpdateRaffleTicketing>,
        raffle_id: u32,
        new_total_tickets: u16,
        new_ticket_price: u64,
        new_max_per_wallet_pct: u8,
    ) -> Result<()> {
        update_raffle_ticketing::update_raffle_ticketing(
            ctx,
            raffle_id,
            new_total_tickets,
            new_ticket_price,
            new_max_per_wallet_pct,
        )
    }

    pub fn update_raffle_time(
        ctx: Context<UpdateRaffleTime>,
        raffle_id: u32,
        new_start_time: i64,
        new_end_time: i64,
    ) -> Result<()> {
        update_raffle_time::update_raffle_time(ctx, raffle_id, new_start_time, new_end_time)
    }

    pub fn update_raffle_winners(
        ctx: Context<UpdateRaffleWinners>,
        raffle_id: u32,
        new_win_shares: Vec<u8>,
        new_is_unique_winners: bool,
    ) -> Result<()> {
        update_raffle_winners::update_raffle_winners(
            ctx,
            raffle_id,
            new_win_shares,
            new_is_unique_winners,
        )
    }

    pub fn withdraw_sol_fees(ctx: Context<WithdrawSolFees>, amount: u64) -> Result<()> {
        withdraw_sol_fees::withdraw_sol_fees(ctx, amount)
    }

    pub fn withdraw_spl_fees(ctx: Context<WithdrawSplFees>, amount: u64) -> Result<()> {
        withdraw_spl_fees::withdraw_spl_fees(ctx, amount)
    }
}
