use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use crate::constants::{BUYER_CLAIM_PRIZE_PAUSE, TOTAL_PCT};
use crate::errors::{ConfigStateErrors, KeysMismatchErrors, RaffleStateErrors};
use crate::helpers::*;
use crate::states::*;
use crate::utils::{get_pct_amount, is_paused};

#[event]
pub struct PrizeClaimed {
    pub raffle_id: u32,
    pub winner: Pubkey,
    pub winner_index: u8,
    pub prize_type: PrizeType,
    pub prize_amount: u64,
    pub claimed_time: i64,
}

pub fn buyer_claim_prize(
    ctx: Context<BuyerClaimPrize>,
    raffle_id: u32,
    winner_index: u8,
) -> Result<()> {
    require!(
        !is_paused(
            ctx.accounts.raffle_config.pause_flags,
            BUYER_CLAIM_PRIZE_PAUSE
        ),
        RaffleStateErrors::FunctionPaused
    );

    let raffle = &mut ctx.accounts.raffle;
    let winner = &ctx.accounts.winner;
    let now = Clock::get()?.unix_timestamp;

    // --- raffle should be succcessfully ended ---
    require!(
        raffle.status == RaffleState::SuccessEnded,
        RaffleStateErrors::RaffleNotSuccessEnded
    );

    let idx = winner_index as usize;
    require!(
        idx < raffle.winners.len(),
        RaffleStateErrors::InvalidWinnerIndex
    );
    require_keys_eq!(
        raffle.winners[idx],
        winner.key(),
        RaffleStateErrors::InvalidWinner
    );
    require!(
        !raffle.is_win_claimed[idx],
        RaffleStateErrors::PrizeAlreadyClaimed
    );

    let share_pct = raffle.win_shares[idx] as u64;
    let prize_amount: u64;

    // PDA seeds for signing
    let seeds: &[&[u8]] = &[
        b"raffle",
        &raffle.raffle_id.to_le_bytes(),
        &[raffle.raffle_bump],
    ];
    let signer_seeds = &[seeds];

    // --- Mark as claimed ---
    raffle.is_win_claimed[idx] = true;

    match raffle.prize_type {
        PrizeType::Sol => {
            let total_prize = raffle.prize_amount;
            let winner_amount = get_pct_amount(total_prize, share_pct, TOTAL_PCT as u64)?;
            require_gt!(winner_amount, 0, RaffleStateErrors::ZeroPrizeForWinner);

            transfer_sol_with_seeds(
                &raffle.to_account_info(),
                &winner.to_account_info(),
                &ctx.accounts.system_program,
                signer_seeds,
                winner_amount,
            )?;

            prize_amount = winner_amount;
        }

        PrizeType::Nft | PrizeType::Spl => {
            let prize_mint_key = raffle
                .prize_mint
                .ok_or(KeysMismatchErrors::MissingPrizeMint)?;
            let stored_escrow = raffle
                .prize_escrow
                .ok_or(KeysMismatchErrors::MissingPrizeEscrow)?;

            // --- Validate prize mint ---
            require_keys_eq!(
                ctx.accounts.prize_mint.key(),
                prize_mint_key,
                KeysMismatchErrors::InvalidPrizeMint
            );
            require_keys_eq!(
                ctx.accounts.prize_escrow.key(),
                stored_escrow,
                KeysMismatchErrors::InvalidPrizeEscrow
            );

            require_keys_eq!(
                ctx.accounts.prize_escrow.owner,
                raffle.key(),
                KeysMismatchErrors::InvalidPrizeEscrowOwner
            );
            require_keys_eq!(
                ctx.accounts.prize_escrow.mint,
                prize_mint_key,
                KeysMismatchErrors::InvalidPrizeMint
            );

            // --- Determine winner amount ---
            let winner_amount = if raffle.prize_type == PrizeType::Nft {
                require_eq!(raffle.num_winners, 1, RaffleStateErrors::InvalidWinnerIndex);
                require_eq!(idx, 0, RaffleStateErrors::InvalidWinnerIndex);
                1u64
            } else {
                get_pct_amount(raffle.prize_amount, share_pct, TOTAL_PCT as u64)?
            };
            require_gt!(winner_amount, 0, RaffleStateErrors::ZeroPrizeForWinner);
            prize_amount = winner_amount;

            // --- Final validation of winner ATA ---
            let winner_ata = &ctx.accounts.winner_prize_ata;
            require_keys_eq!(
                winner_ata.mint,
                prize_mint_key,
                KeysMismatchErrors::InvalidPrizeMint
            );

            // --- SAFE TOKEN TRANSFER (with mint + decimals) ---
            transfer_tokens_with_seeds(
                &ctx.accounts.prize_escrow,
                winner_ata,
                &raffle.to_account_info(),
                &ctx.accounts.prize_token_program,
                &ctx.accounts.prize_mint,
                signer_seeds,
                winner_amount,
            )?;
        }
    }

    // --- Emit event ---
    emit!(PrizeClaimed {
        raffle_id,
        winner: winner.key(),
        winner_index,
        prize_type: raffle.prize_type,
        prize_amount,
        claimed_time: now,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(raffle_id: u32, winner_index: u8)]
pub struct BuyerClaimPrize<'info> {
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

    // Admin must co-sign to allow claims
    pub raffle_admin: Signer<'info>,

    // Winner who is claiming their prize
    #[account(mut)]
    pub winner: Signer<'info>,

    // Mint of the prize (SPL/NFT). Unused for SOL.
    pub prize_mint: InterfaceAccount<'info, Mint>,

    // Escrow that holds prize tokens (SPL/NFT), owned by raffle PDA.
    #[account(mut)]
    pub prize_escrow: InterfaceAccount<'info, TokenAccount>,

    // Winner ATA for prize mint; created if missing (payer = winner)
    #[account(mut)]
    pub winner_prize_ata: InterfaceAccount<'info, TokenAccount>,

    pub prize_token_program: Interface<'info, TokenInterface>,

    pub system_program: Program<'info, System>,
}
