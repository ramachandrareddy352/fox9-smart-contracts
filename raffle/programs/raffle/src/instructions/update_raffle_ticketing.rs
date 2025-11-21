use crate::constants::TOTAL_PCT;
use crate::errors::RaffleErrors;
use crate::states::{PrizeType, Raffle, RaffleConfig, RaffleState};
use anchor_lang::prelude::*;

pub fn update_raffle_ticketing(
    ctx: Context<UpdateRaffleTicketing>,
    raffle_id: u32,
    new_total_tickets: u16,
    new_ticket_price: u64,
    new_max_per_wallet_pct: u8,
) -> Result<()> {
    let config = &ctx.accounts.raffle_config;
    let raffle = &mut ctx.accounts.raffle;
    let creator = &ctx.accounts.creator;

    // Only Initialized or Active raffles can be updated
    require!(
        matches!(
            raffle.status,
            RaffleState::Initialized | RaffleState::Active
        ),
        RaffleErrors::InvalidRaffleStateForUpdate
    );

    // No tickets sold yet
    require_eq!(raffle.tickets_sold, 0, RaffleErrors::TicketsAlreadySold);

    // Basic ticketing validations
    require_gt!(new_ticket_price, 0, RaffleErrors::InvalidTicketZeroPrice);
    require!(
        config.minimum_tickets <= new_total_tickets && new_total_tickets <= config.maximum_tickets,
        RaffleErrors::InvalidTotalTickets
    );
    require_gte!(
        new_total_tickets,
        raffle.num_winners as u16,
        RaffleErrors::WinnersExceedTotalTickets
    );

    // Ensure at least 1 ticket possible under max_per_wallet_pct
    let min_per_wallet_pct = ((TOTAL_PCT as u16 + new_total_tickets - 1) / new_total_tickets) as u8;
    require!(
        new_max_per_wallet_pct >= min_per_wallet_pct
            && new_max_per_wallet_pct <= config.maximum_wallet_pct,
        RaffleErrors::InvalidMaxPerWalletPct
    );

    // Apply updates
    raffle.total_tickets = new_total_tickets;
    raffle.ticket_price = new_ticket_price;
    raffle.max_per_wallet_pct = new_max_per_wallet_pct;

    emit!(RaffleTicketingUpdated {
        raffle_id,
        new_total_tickets,
        new_ticket_price,
        new_max_per_wallet_pct,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(raffle_id: u32)]
pub struct UpdateRaffleTicketing<'info> {
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
        constraint = raffle.raffle_id == raffle_id @ RaffleErrors::InvalidRaffleId,
    )]
    pub raffle: Box<Account<'info, Raffle>>,

    #[account(
        mut,
        constraint = raffle.creator == creator.key() @ RaffleErrors::InvalidCreator,
    )]
    pub creator: Signer<'info>,

    pub raffle_admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}
