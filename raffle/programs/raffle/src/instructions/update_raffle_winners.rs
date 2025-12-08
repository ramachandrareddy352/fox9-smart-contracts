use anchor_lang::prelude::*;
use crate::constants::UPDATE_RAFFLE_PAUSE;
use crate::errors::{ConfigStateErrors, RaffleStateErrors};
use crate::states::*;
use crate::utils::{is_paused, validate_win_shares};

#[event]
pub struct RaffleWinnersUpdated {
    pub raffle_id: u32,
    pub win_shares: Vec<u8>,
    pub is_unique_winners: bool,
}

pub fn update_raffle_winners(
    ctx: Context<UpdateRaffleWinners>,
    raffle_id: u32,
    new_win_shares: Vec<u8>,
    new_is_unique_winners: bool,
) -> Result<()> {
    require!(
        !is_paused(ctx.accounts.raffle_config.pause_flags, UPDATE_RAFFLE_PAUSE),
        RaffleStateErrors::FunctionPaused
    );

    let raffle = &mut ctx.accounts.raffle;

    // Only allow updates before any tickets are sold
    require!(
        matches!(
            raffle.status,
            RaffleState::Initialized | RaffleState::Active
        ),
        RaffleStateErrors::InvalidRaffleStateForUpdate
    );
    require_eq!(raffle.tickets_sold, 0, RaffleStateErrors::TicketsSoldOut);

    // Cannot update winner shares for NFT prizes
    require!(
        raffle.prize_type != PrizeType::Nft,
        RaffleStateErrors::CannotUpdateWinnersForNftPrize
    );

    // Validate win shares length and distribution
    require!(
        new_win_shares.len() == raffle.num_winners as usize && validate_win_shares(&new_win_shares),
        RaffleStateErrors::InvalidWinShares
    );

    // Emit event before updating state
    emit!(RaffleWinnersUpdated {
        raffle_id,
        win_shares: new_win_shares.clone(),
        is_unique_winners: new_is_unique_winners,
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
