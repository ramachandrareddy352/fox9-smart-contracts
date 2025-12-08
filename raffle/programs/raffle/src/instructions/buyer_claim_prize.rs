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

pub fn buyer_claim_prize(ctx: Context<BuyerClaimPrize>, raffle_id: u32) -> Result<()> {
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

    // Must be success ended
    require!(
        raffle.status == RaffleState::SuccessEnded,
        RaffleStateErrors::RaffleNotSuccessEnded
    );

    let num_winners = raffle.winners.len();

    // COLLECT ALL WINNER INDICES FOR THIS USER
    let mut claim_indices: Vec<usize> = Vec::new();
    for i in 0..num_winners {
        if raffle.winners[i] == winner.key() && !raffle.is_win_claimed[i] {
            claim_indices.push(i);
        }
    }

    // Must have something to claim
    require!(
        !claim_indices.is_empty(),
        RaffleStateErrors::PrizeAlreadyClaimed
    );

    // PDA signer
    let seeds: &[&[u8]] = &[
        b"raffle",
        &raffle.raffle_id.to_le_bytes(),
        &[raffle.raffle_bump],
    ];
    let signer_seeds = &[seeds];

    // Mark all as claimed first (atomic)
    for &idx in claim_indices.iter() {
        raffle.is_win_claimed[idx] = true;
    }

    // Prize type switch
    match raffle.prize_type {
        PrizeType::Sol => {
            let total_prize = raffle.prize_amount;
            let mut total_send: u64 = 0;

            for &idx in claim_indices.iter() {
                let pct = raffle.win_shares[idx] as u64;
                let amt = get_pct_amount(total_prize, pct, TOTAL_PCT as u64)?;
                require_gt!(amt, 0, RaffleStateErrors::ZeroPrizeForWinner);

                total_send = total_send
                    .checked_add(amt)
                    .ok_or(RaffleStateErrors::Overflow)?;
            }

            transfer_sol_with_seeds(
                &raffle.to_account_info(),
                &winner.to_account_info(),
                &ctx.accounts.system_program,
                signer_seeds,
                total_send,
            )?;

            // Emit per-index events
            for &idx in claim_indices.iter() {
                let pct = raffle.win_shares[idx] as u64;
                let amt = get_pct_amount(total_prize, pct, TOTAL_PCT as u64)?;

                emit!(PrizeClaimed {
                    raffle_id,
                    winner: winner.key(),
                    winner_index: idx as u8,
                    prize_type: PrizeType::Sol,
                    prize_amount: amt,
                    claimed_time: now,
                });
            }
        }

        PrizeType::Nft | PrizeType::Spl => {
            let stored_prize_mint = raffle
                .prize_mint
                .ok_or(KeysMismatchErrors::MissingPrizeMint)?;

            let prize_mint = &ctx.accounts.prize_mint;
            let prize_escrow = &ctx.accounts.prize_escrow;
            let winner_prize_ata = &ctx.accounts.winner_prize_ata;

            require!(
                prize_mint.key() == stored_prize_mint
                    && winner_prize_ata.mint == stored_prize_mint
                    && prize_escrow.mint == stored_prize_mint,
                KeysMismatchErrors::InvalidPrizeMint
            );
            require_keys_eq!(
                prize_escrow.owner,
                raffle.key(),
                KeysMismatchErrors::InvalidPrizeEscrowOwner
            );
            require_keys_eq!(
                winner_prize_ata.owner,
                winner.key(),
                KeysMismatchErrors::InvalidPrizeAtaOwner
            );

            // NFT → only 1 index MUST belong to user
            if raffle.prize_type == PrizeType::Nft {
                require!(
                    claim_indices.len() == 1,
                    RaffleStateErrors::InvalidWinnerIndex
                );
            }

            // TOTAL amount to send for SPL tokens
            let mut total_tokens: u64 = 0;
            let mut per_index_amounts: Vec<u64> = Vec::new();

            if raffle.prize_type == PrizeType::Nft {
                per_index_amounts.push(1);
                total_tokens = 1;
            } else {
                // SPL
                for &idx in claim_indices.iter() {
                    let pct = raffle.win_shares[idx] as u64;
                    let amt = get_pct_amount(raffle.prize_amount, pct, TOTAL_PCT as u64)?;
                    require_gt!(amt, 0, RaffleStateErrors::ZeroPrizeForWinner);

                    per_index_amounts.push(amt);
                    total_tokens = total_tokens
                        .checked_add(amt)
                        .ok_or(RaffleStateErrors::Overflow)?;
                }
            }

            // Transfer once
            transfer_tokens_with_seeds(
                prize_escrow,
                winner_prize_ata,
                &raffle.to_account_info(),
                &ctx.accounts.prize_token_program,
                prize_mint,
                signer_seeds,
                total_tokens,
            )?;

            // Emit events
            for (i, &idx) in claim_indices.iter().enumerate() {
                emit!(PrizeClaimed {
                    raffle_id,
                    winner: winner.key(),
                    winner_index: idx as u8,
                    prize_type: raffle.prize_type,
                    prize_amount: per_index_amounts[i],
                    claimed_time: now,
                });
            }
        }
    }

    Ok(())
}

#[derive(Accounts)]
#[instruction(raffle_id: u32)]
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

    #[account(
        mut,
        close = winner,
        seeds = [
            b"raffle",
            raffle_id.to_le_bytes().as_ref(),
            winner.key().as_ref(),
        ],
        bump,        
        constraint = buyer_account.raffle_id == raffle_id @ RaffleStateErrors::InvalidRaffleId,
        constraint = buyer_account.user == winner.key() @ KeysMismatchErrors::InvalidBuyerAccountUser,
    )]
    pub buyer_account: Box<Account<'info, Buyer>>,

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
