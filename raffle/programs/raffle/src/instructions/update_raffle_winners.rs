use crate::errors::RaffleErrors;
use crate::raffle_math::is_descending_order_and_sum_100;
use crate::states::{PrizeType, Raffle, RaffleConfig, RaffleState};
use anchor_lang::prelude::*;

pub fn update_raffle_winners(
    ctx: Context<UpdateRaffleWinners>,
    raffle_id: u32,
    new_win_shares: Vec<u8>,
    new_is_unique_winners: bool,
) -> Result<()> {
    let raffle = &mut ctx.accounts.raffle;
    let creator = &ctx.accounts.creator;

    // Identity & access
    require_eq!(raffle.raffle_id, raffle_id, RaffleErrors::InvalidRaffleId);
    require_keys_eq!(raffle.creator, creator.key(), RaffleErrors::InvalidCreator);

    // Only allow updates before any tickets are sold
    require!(
        matches!(
            raffle.status,
            RaffleState::Initialized | RaffleState::Active
        ),
        RaffleErrors::InvalidRaffleStateForUpdate
    );
    require_eq!(raffle.tickets_sold, 0, RaffleErrors::TicketsAlreadySold);

    // Cannot update winner shares for NFT prizes
    require!(
        raffle.prize_type != PrizeType::Nft,
        RaffleErrors::CannotUpdateWinnersForNftPrize
    );

    // Validate win shares length and distribution
    require!(
        new_win_shares.len() == raffle.num_winners as usize,
        RaffleErrors::InvalidWinSharesLength
    );
    require!(
        is_descending_order_and_sum_100(&new_win_shares),
        RaffleErrors::InvalidWinShares
    );

    // Emit event before updating state
    emit!(RaffleWinnersUpdated {
        raffle_id,
        new_win_shares: new_win_shares.clone(),
        new_is_unique_winners,
    });

    // Apply updates
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
        constraint = raffle.raffle_id == raffle_id @ RaffleErrors::InvalidRaffleId,
    )]
    pub raffle: Box<Account<'info, Raffle>>,

    #[account(
        mut,
        constraint = raffle.creator == creator.key() @ RaffleErrors::InvalidCreator,
    )]
    pub creator: Signer<'info>,

    pub raffle_admin: Signer<'info>,
}
