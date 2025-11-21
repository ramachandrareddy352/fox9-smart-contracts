use crate::errors::RaffleErrors;
use crate::helpers::*;
use crate::states::{PrizeType, Raffle, RaffleConfig, RaffleState};
use crate::utils::get_pct_amount;
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

pub fn claim_prize(ctx: Context<ClaimPrize>, raffle_id: u32, winner_index: u8) -> Result<()> {
    let raffle_config = &ctx.accounts.raffle_config;
    let raffle = &mut ctx.accounts.raffle;
    let winner = &ctx.accounts.winner;

    // Basic checks
    require_eq!(raffle.raffle_id, raffle_id, RaffleErrors::InvalidRaffleId);

    let idx = winner_index as usize;
    let num_winners = raffle.num_winners as usize;
    require!(idx < num_winners, RaffleErrors::InvalidWinnerIndex);

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

    // Compute winner's share for SPL/SOL/NFT
    let share_pct = raffle.win_shares[idx] as u64;

    // PDA signer seeds for raffle as authority
    let raffle_ai = raffle.to_account_info();
    let signer_seeds: &[&[&[u8]]] = &[&[
        b"raffle",
        &raffle.raffle_id.to_le_bytes(),
        &[raffle.raffle_bump],
    ]];

    match raffle.prize_type {
        PrizeType::Sol => {
            // SOL: proportional share from raffle PDA lamports
            let total_prize = raffle.prize_amount;
            let winner_amount = get_pct_amount(total_prize, share_pct, TOTAL_PCT as u64)?;

            require_gt!(winner_amount, 0, RaffleErrors::ZeroPrizeForWinner);

            transfer_sol_with_seeds(
                &raffle_ai,
                &winner.to_account_info(),
                &ctx.accounts.system_program,
                signer_seeds,
                winner_amount,
            )?;
        }
        PrizeType::Nft | PrizeType::Spl => {
            // Token-based: NFT/SPL from prize_escrow
            let prize_mint_key = raffle.prize_mint.ok_or(RaffleErrors::MissingPrizeMint)?;

            // Deserialize accounts for validation and CPI
            let prize_escrow = InterfaceAccount::<TokenAccount>::try_from(
                &ctx.accounts.prize_escrow.to_account_info(),
            )?;
            let prize_mint_acc =
                InterfaceAccount::<Mint>::try_from(&ctx.accounts.prize_mint.to_account_info())?;
            let prize_token_program = InterfaceAccount::<TokenInterface>::try_from(
                &ctx.accounts.prize_token_program.to_account_info(),
            )?;
            let winner_prize_ata_raw = &ctx.accounts.winner_prize_ata.to_account_info();

            // Validate mint & escrow
            require_keys_eq!(
                prize_mint_acc.key(),
                prize_mint_key,
                RaffleErrors::InvalidPrizeMint
            );

            let stored_escrow = raffle
                .prize_escrow
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
                prize_mint_key,
                RaffleErrors::InvalidPrizeMint
            );
            require_keys_eq!(
                prize_escrow.token_program,
                prize_token_program.key(),
                RaffleErrors::InvalidTokenProgram
            );

            // Compute amount: 1 for NFT, pct for SPL
            let winner_amount = if raffle.prize_type == PrizeType::Nft {
                require!(
                    num_winners == 1 && idx == 0,
                    RaffleErrors::InvalidWinnerIndexForNft
                );
                1u64
            } else {
                let total_prize = raffle.prize_amount;
                get_pct_amount(total_prize, share_pct, TOTAL_PCT as u64)?
            };
            require_gt!(winner_amount, 0, RaffleErrors::ZeroPrizeForWinner);

            // Ensure winner ATA exists (payer = winner), owner = winner, mint = prize_mint
            create_ata(
                &winner.to_account_info(),
                winner_prize_ata_raw,
                &winner.to_account_info(),
                &ctx.accounts.prize_mint.to_account_info(),
                &ctx.accounts.system_program.to_account_info(),
                &ctx.accounts.prize_token_program.to_account_info(),
                &ctx.accounts.associated_token_program.to_account_info(),
            )?;

            // Deserialize winner_prize_ata after potential creation
            let winner_prize_ata =
                InterfaceAccount::<TokenAccount>::try_from(winner_prize_ata_raw)?;

            require_keys_eq!(
                winner_prize_ata.owner,
                winner.key(),
                RaffleErrors::InvalidWinnerPrizeAtaOwner
            );
            require_keys_eq!(
                winner_prize_ata.mint,
                prize_mint_key,
                RaffleErrors::InvalidWinnerPrizeAtaMint
            );

            // Transfer tokens from escrow -> winner ATA
            transfer_tokens_with_seeds(
                &prize_escrow,
                &winner_prize_ata,
                &raffle_ai,
                &prize_token_program,
                signer_seeds,
                winner_amount,
            )?;
        }
    }

    // Mark this winner as claimed
    raffle.is_win_claimed[idx] = true;

    // Emit event
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
        constraint = raffle.raffle_id == raffle_id @ RaffleErrors::InvalidRaffleId,
    )]
    pub raffle: Box<Account<'info, Raffle>>,

    /// Admin must co-sign to allow claims
    pub raffle_admin: Signer<'info>,

    /// Winner who is claiming their prize
    #[account(mut)]
    pub winner: Signer<'info>,

    /// Mint of the prize (SPL/NFT). Unused for SOL.
    pub prize_mint: UncheckedAccount<'info>,

    /// Escrow that holds prize tokens (SPL/NFT), owned by raffle PDA.
    #[account(mut)]
    pub prize_escrow: UncheckedAccount<'info>,

    /// Winner ATA for prize mint; created if missing (payer = winner)
    #[account(mut)]
    pub winner_prize_ata: UncheckedAccount<'info>,

    pub prize_token_program: UncheckedAccount<'info>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
