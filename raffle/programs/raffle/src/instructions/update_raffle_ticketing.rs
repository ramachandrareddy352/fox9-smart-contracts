use crate::constants::*;
use crate::errors::{ConfigStateErrors, RaffleStateErrors};
use crate::states::{Raffle, RaffleConfig, RaffleState};
use crate::utils::is_paused;

#[event]
pub struct RaffleTicketingUpdated {
    pub raffle_id: u32,
    pub new_total_tickets: u16,
    pub new_ticket_price: u64,
    pub new_max_per_wallet_pct: u8,
}

pub fn update_raffle_ticketing(
    ctx: Context<UpdateRaffleTicketing>,
    raffle_id: u32,
    new_total_tickets: u16,
    new_ticket_price: u64,
    new_max_per_wallet_pct: u8,
) -> Result<()> {
    require!(
        !is_paused(ctx.accounts.raffle_config.pause_flags, UPDATE_RAFFLE_PAUSE),
        RaffleStateErrors::FunctionPaused
    );

    let raffle = &mut ctx.accounts.raffle;

    // Only Initialized or Active raffles can be updated
    require!(
        matches!(
            raffle.status,
            RaffleState::Initialized | RaffleState::Active
        ),
        RaffleStateErrors::InvalidRaffleStateForUpdate
    );

    // No tickets sold yet
    require_eq!(
        raffle.tickets_sold,
        0,
        RaffleStateErrors::RaffleAlreadyStarted
    );

    // Basic ticketing validations
    require_gt!(
        new_ticket_price,
        0,
        RaffleStateErrors::InvalidTicketZeroPrice
    );
    require!(
        MINIMUM_TICKETS <= new_total_tickets && new_total_tickets <= MAXIMUM_TICKETS,
        RaffleStateErrors::InvalidTotalTickets
    );
    require_gte!(
        new_total_tickets,
        raffle.num_winners as u16,
        RaffleStateErrors::WinnersExceedTotalTickets
    );

    // Ensure at least 1 ticket possible under max_per_wallet_pct
    let min_per_wallet_pct = ((TOTAL_PCT as u16 + new_total_tickets - 1) / new_total_tickets) as u8;
    require!(
        new_max_per_wallet_pct >= min_per_wallet_pct
            && new_max_per_wallet_pct <= MAXIMUM_WALLET_PCT,
        RaffleStateErrors::MaxTicketsPerWalletExceeded
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
