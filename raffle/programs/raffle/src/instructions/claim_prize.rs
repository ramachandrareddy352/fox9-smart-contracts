use crate::errors::RaffleErrors;
use crate::raffle_math::TOTAL_PCT;
use crate::states::{PrizeType, Raffle, RaffleConfig, RaffleState};
use crate::transfer_helpers::{create_ata, transfer_sol_with_seeds};
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{
    transfer as spl_transfer, Mint, TokenAccount, TokenInterface, Transfer,
};

pub fn claim_prize(ctx: Context<ClaimPrize>, raffle_id: u32, winner_index: u8) -> Result<()> {
    let raffle_config = &ctx.accounts.raffle_config;
    let raffle = &mut ctx.accounts.raffle;
    let winner = &ctx.accounts.winner;

    // Basic checks
    require_eq!(raffle.raffle_id, raffle_id, RaffleErrors::InvalidRaffleId);

    // Only SuccessEnded raffles can be claimed
    require!(
        raffle.status == RaffleState::SuccessEnded,
        RaffleErrors::RaffleNotSuccessEnded
    );

    let idx = winner_index as usize;
    let num_winners = raffle.num_winners as usize;

    require!(idx < num_winners, RaffleErrors::InvalidWinnerIndex);

    // Ensure winners vector is properly sized
    require!(
        raffle.winners.len() == num_winners && raffle.is_win_claimed.len() == num_winners,
        RaffleErrors::InvalidWinnersState
    );

    // Ensure the caller is the winner at this index
    require_keys_eq!(
        raffle.winners[idx],
        winner.key(),
        RaffleErrors::InvalidWinner
    );

    // Cannot double-claim
    require!(
        !raffle.is_win_claimed[idx],
        RaffleErrors::PrizeAlreadyClaimed
    );

    // Compute winner's share for SPL/SOL
    let share_pct = raffle.win_shares[idx] as u64;

    // PDA signer seeds for raffle as authority
    let raffle_ai = raffle.to_account_info();
    let seeds: &[&[u8]] = &[
        b"raffle",
        &raffle.raffle_id.to_le_bytes(),
        &[raffle.raffle_bump],
    ];
    let signer_seeds: &[&[&[u8]]] = &[seeds];

    match raffle.prize_type {
        PrizeType::Nft => {
            // NFT: single token, only index 0 valid logically
            require!(num_winners == 1, RaffleErrors::InvalidWinnerIndexForNft);
            require!(idx == 0, RaffleErrors::InvalidWinnerIndexForNft);

            let prize_mint_key = raffle.prize_mint.ok_or(RaffleErrors::MissingPrizeMint)?;

            let prize_mint = &ctx.accounts.prize_mint;
            let prize_escrow = &ctx.accounts.prize_escrow;
            let winner_prize_ata = &ctx.accounts.winner_prize_ata;
            let token_program = &ctx.accounts.prize_token_program;

            // Validate mint & escrow
            require_keys_eq!(
                prize_mint.key(),
                prize_mint_key,
                RaffleErrors::InvalidPrizeMint
            );

            let stored_escrow = raffle
                .price_escrow
                .ok_or(RaffleErrors::MissingPrizeEscrow)?;
            require_keys_eq!(
                prize_escrow.key(),
                stored_escrow,
                RaffleErrors::InvalidPrizeEscrow
            );
            require_keys_eq!(
                prize_escrow.owner,
                raffle.key(),
                RaffleErrors::InvalidPrizeEscrowOwner
            );
            require_keys_eq!(
                prize_escrow.mint,
                prize_mint.key(),
                RaffleErrors::InvalidPrizeMint
            );

            // Ensure winner ATA exists (payer = winner), owner = winner, mint = prize_mint
            create_ata(
                &winner.to_account_info(),
                &winner_prize_ata.to_account_info(),
                &winner.to_account_info(),
                &prize_mint.to_account_info(),
                &ctx.accounts.system_program.to_account_info(),
                &token_program.to_account_info(),
                &ctx.accounts.associated_token_program.to_account_info(),
            )?;

            // Transfer exactly 1 token (NFT)
            spl_transfer(
                CpiContext::new_with_signer(
                    token_program.to_account_info(),
                    Transfer {
                        from: prize_escrow.to_account_info(),
                        to: winner_prize_ata.to_account_info(),
                        authority: raffle_ai.clone(),
                    },
                    signer_seeds,
                ),
                1,
            )
            .map_err(|_| error!(RaffleErrors::TokenTransferFailed))?;
        }

        PrizeType::Sol => {
            // SOL: proportional share from raffle PDA lamports
            let total_prize = raffle.prize_amount;
            let winner_amount = total_prize
                .checked_mul(share_pct)
                .ok_or(RaffleErrors::Overflow)?
                .checked_div(TOTAL_PCT as u64)
                .ok_or(RaffleErrors::Overflow)?;

            require_gt!(winner_amount, 0, RaffleErrors::ZeroPrizeForWinner);

            transfer_sol_with_seeds(
                &raffle_ai,
                &winner.to_account_info(),
                &ctx.accounts.system_program,
                signer_seeds,
                winner_amount,
            )?;
        }

        PrizeType::Spl => {
            // SPL: proportional share from prize_escrow
            let prize_mint_key = raffle.prize_mint.ok_or(RaffleErrors::MissingPrizeMint)?;

            let prize_mint = &ctx.accounts.prize_mint;
            let prize_escrow = &ctx.accounts.prize_escrow;
            let winner_prize_ata = &ctx.accounts.winner_prize_ata;
            let token_program = &ctx.accounts.prize_token_program;

            // Validate mint & escrow
            require_keys_eq!(
                prize_mint.key(),
                prize_mint_key,
                RaffleErrors::InvalidPrizeMint
            );

            let stored_escrow = raffle
                .price_escrow
                .ok_or(RaffleErrors::MissingPrizeEscrow)?;
            require_keys_eq!(
                prize_escrow.key(),
                stored_escrow,
                RaffleErrors::InvalidPrizeEscrow
            );
            require_keys_eq!(
                prize_escrow.owner,
                raffle.key(),
                RaffleErrors::InvalidPrizeEscrowOwner
            );
            require_keys_eq!(
                prize_escrow.mint,
                prize_mint.key(),
                RaffleErrors::InvalidPrizeMint
            );

            let total_prize = raffle.prize_amount;
            let winner_amount = total_prize
                .checked_mul(share_pct)
                .ok_or(RaffleErrors::Overflow)?
                .checked_div(TOTAL_PCT as u64)
                .ok_or(RaffleErrors::Overflow)?;

            require_gt!(winner_amount, 0, RaffleErrors::ZeroPrizeForWinner);

            // Ensure winner ATA exists (payer = winner), owner = winner, mint = prize_mint
            create_ata(
                &winner.to_account_info(),
                &winner_prize_ata.to_account_info(),
                &winner.to_account_info(),
                &prize_mint.to_account_info(),
                &ctx.accounts.system_program.to_account_info(),
                &token_program.to_account_info(),
                &ctx.accounts.associated_token_program.to_account_info(),
            )?;

            // Transfer SPL tokens from escrow -> winner ATA
            spl_transfer(
                CpiContext::new_with_signer(
                    token_program.to_account_info(),
                    Transfer {
                        from: prize_escrow.to_account_info(),
                        to: winner_prize_ata.to_account_info(),
                        authority: raffle_ai,
                    },
                    signer_seeds,
                ),
                winner_amount,
            )
            .map_err(|_| error!(RaffleErrors::TokenTransferFailed))?;
        }
    }

    // Mark this winner as claimed (after all checks, but before exit)
    raffle.is_win_claimed[idx] = true;

    // emit event
    emit!(PrizeClaimed {
        raffle_id,
        winner: winner.key(),
        winner_index,
        prize_type: raffle.prize_type,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(raffle_id: u32, winner_index: u8)]
pub struct ClaimPrize<'info> {
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
        constraint = raffle.status == RaffleState::SuccessEnded @ RaffleErrors::RaffleNotSuccessEnded,
    )]
    pub raffle: Box<Account<'info, Raffle>>,

    /// Admin must co-sign to allow claims
    #[account(mut)]
    pub raffle_admin: Signer<'info>,

    /// Winner who is claiming their prize
    #[account(mut)]
    pub winner: Signer<'info>,

    /// Mint of the prize (SPL/NFT). Unused for SOL but still provided.
    pub prize_mint: InterfaceAccount<'info, Mint>,

    /// Escrow that holds prize tokens (SPL/NFT), owned by raffle PDA.
    #[account(mut)]
    pub prize_escrow: InterfaceAccount<'info, TokenAccount>,

    /// Winner ATA for prize mint; created if missing (payer = winner)
    #[account(mut)]
    pub winner_prize_ata: InterfaceAccount<'info, TokenAccount>,

    pub prize_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
