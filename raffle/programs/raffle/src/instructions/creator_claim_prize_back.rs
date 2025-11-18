use crate::errors::RaffleErrors;
use crate::states::{PrizeType, Raffle, RaffleConfig, RaffleState};
use crate::transfer_helpers::{create_ata, transfer_sol_with_seeds};
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{transfer, Mint, TokenAccount, TokenInterface, Transfer};

pub fn creator_claim_prize_back(ctx: Context<CreatorClaimPrizeBack>, raffle_id: u32) -> Result<()> {
    let raffle_config = &ctx.accounts.raffle_config;
    let raffle = &mut ctx.accounts.raffle;
    let creator = &ctx.accounts.creator;

    // Access control & identity
    require_eq!(raffle.raffle_id, raffle_id, RaffleErrors::InvalidRaffleId);
    require_keys_eq!(raffle.creator, creator.key(), RaffleErrors::InvalidCreator);

    // Only in FailedEnded or SuccessEnded
    require!(
        matches!(
            raffle.status,
            RaffleState::FailedEnded | RaffleState::SuccessEnded
        ),
        RaffleErrors::InvalidRaffleStateForClaimBack
    );

    // Must have something to claim
    let claimable = raffle.claimable_prize_back;
    require_gt!(claimable, 0, RaffleErrors::NoClaimablePrize);

    // Signer seeds for raffle PDA (authority of escrow / SOL)
    let raffle_ai = raffle.to_account_info();

    match raffle.prize_type {
        PrizeType::Sol => {
            // --------------------------------------------------
            // SOL: transfer lamports from raffle PDA -> creator
            // --------------------------------------------------
            transfer_sol_with_seeds(
                &raffle_ai,
                &creator.to_account_info(),
                &ctx.accounts.system_program,
                signer_seeds,
                claimable,
            )?;
        }

        PrizeType::Nft | PrizeType::Spl => {
            // --------------------------------------------------
            // NFT / SPL: transfer tokens from prize_escrow -> creator ATA
            let seeds: &[&[u8]] = &[
                b"raffle",
                &raffle.raffle_id.to_le_bytes(),
                &[raffle.raffle_bump],
            ];
            let signer_seeds: &[&[&[u8]]] = &[seeds];

            let stored_mint = raffle.prize_mint.ok_or(RaffleErrors::MissingPrizeMint)?;

            let prize_mint = &ctx.accounts.prize_mint;
            let prize_escrow = &ctx.accounts.prize_escrow;
            let creator_prize_ata = &ctx.accounts.creator_prize_ata;

            // Stored mint must match provided mint
            require_keys_eq!(
                prize_mint.key(),
                stored_mint,
                RaffleErrors::InvalidPrizeMint
            );

            // Stored escrow must match provided escrow
            let stored_escrow = raffle
                .price_escrow
                .ok_or(RaffleErrors::MissingPrizeEscrow)?;
            require_keys_eq!(
                prize_escrow.key(),
                stored_escrow,
                RaffleErrors::InvalidPrizeEscrow
            );

            // Escrow must be owned by raffle PDA
            require_keys_eq!(
                prize_escrow.owner,
                raffle.key(),
                RaffleErrors::InvalidPrizeEscrowOwner
            );

            // Ensure creator ATA is the correct ATA for (creator, prize_mint)
            // If not present, create it.
            create_ata(
                &creator.to_account_info(),
                &creator_prize_ata.to_account_info(),
                &creator.to_account_info(),
                &prize_mint.to_account_info(),
                &ctx.accounts.system_program.to_account_info(),
                &ctx.accounts.prize_token_program.to_account_info(),
                &ctx.accounts.associated_token_program.to_account_info(),
            )?;

            // Transfer SPL/NFT tokens from escrow -> creator ATA via raffle PDA authority
            transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.prize_token_program.to_account_info(),
                    Transfer {
                        from: prize_escrow.to_account_info(),
                        to: creator_prize_ata.to_account_info(),
                        authority: raffle_ai,
                    },
                    signer_seeds,
                ),
                claimable,
            )
            .map_err(|_| error!(RaffleErrors::TokenTransferFailed))?;
        }
    }

    // Reset claimable amount so it can't be claimed again
    raffle.claimable_prize_back = 0;

    // emit event
    emit!(PrizeBackClaimed {
        raffle_id: raffle.raffle_id,
        creator: creator.key(),
        prize_type: raffle.prize_type,
        amount: claimable,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(raffle_id: u32)]
pub struct CreatorClaimPrizeBack<'info> {
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
        constraint = raffle.creator == creator.key() @ RaffleErrors::InvalidCreator,
    )]
    pub raffle: Box<Account<'info, Raffle>>,

    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(mut)]
    pub raffle_admin: Signer<'info>,

    /// Prize mint for SPL/NFT (unused for SOL, but must be a valid account)
    pub prize_mint: InterfaceAccount<'info, Mint>,

    /// Prize escrow ATA owned by raffle PDA (for SPL/NFT)
    #[account(mut)]
    pub prize_escrow: InterfaceAccount<'info, TokenAccount>,

    /// Creator ATA for prize mint (may be created if missing)
    #[account(mut)]
    pub creator_prize_ata: UncheckedAccount<'info>,

    pub prize_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
