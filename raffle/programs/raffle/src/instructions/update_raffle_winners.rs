use crate::errors::RaffleErrors;
use crate::raffle_math::is_descending_order_and_sum_100;
use crate::states::{PrizeType, Raffle, RaffleConfig, RaffleState};
use anchor_lang::prelude::*;

pub fn update_raffle_winners(
    ctx: Context<UpdateRaffleWinners>,
    raffle_id: u32,
    new_num_winners: u8,
    new_win_shares: Vec<u8>,
    new_is_unique_winners: bool,
) -> Result<()> {
    let config = &ctx.accounts.raffle_config;
    let raffle = &mut ctx.accounts.raffle;
    let creator = &ctx.accounts.creator;

    // Identity & access
    require_eq!(raffle.raffle_id, raffle_id, RaffleErrors::InvalidRaffleId);
    require_keys_eq!(raffle.creator, creator.key(), RaffleErrors::InvalidCreator);

    // Only Initialized or Active
    require!(
        matches!(
            raffle.status,
            RaffleState::Initialized | RaffleState::Active
        ),
        RaffleErrors::InvalidRaffleStateForUpdate
    );

    // No tickets sold yet
    require_eq!(raffle.tickets_sold, 0, RaffleErrors::TicketsAlreadySold);

    // Prize must NOT be NFT for updates
    require!(
        raffle.prize_type != PrizeType::Nft,
        RaffleErrors::CannotUpdateWinnersForNftPrize
    );

    // Basic winner count checks
    require_gt!(new_num_winners, 0, RaffleErrors::InvalidZeroWinnersCount);
    require!(
        new_num_winners <= config.maximum_winners_count,
        RaffleErrors::ExceedMaxWinners
    );
    require_gte!(
        raffle.total_tickets,
        new_num_winners as u16,
        RaffleErrors::WinnersExceedTotalTickets
    );
    require_gte!(
        raffle.prize_amount,
        new_num_winners as u64,
        RaffleErrors::InsufficientPrizeAmount
    );

    // Win shares checks
    require!(
        new_win_shares.len() == new_num_winners as usize,
        RaffleErrors::InvalidWinSharesLength
    );
    require!(
        new_win_shares.iter().all(|&s| s > 0),
        RaffleErrors::InvalidZeroShareWinner
    );
    require!(
        is_descending_order_and_sum_100(&new_win_shares),
        RaffleErrors::InvalidWinShares
    );

    // Apply updates
    raffle.num_winners = new_num_winners;
    raffle.win_shares = new_win_shares;
    raffle.is_unique_winners = new_is_unique_winners;

    Ok(())
}

#[derive(Accounts)]
#[instruction(raffle_id: u32)]
pub struct UpdateRaffleWinners<'info> {
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
}
