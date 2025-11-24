use crate::errors::{ConfigStateErrors, KeysMismatchErrors, RaffleStateErrors};
use crate::helpers::*;
use crate::states::*;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

#[event]
pub struct AmountClaimBack {
    pub raffle_id: u32,
    pub claimer: Pubkey,
    pub prize_amount_claimable: u64,
    pub ticket_amount_claimable: u64,
    pub claimed_time: i64,
}

pub fn claim_amount_back(ctx: Context<ClaimAmountBack>, raffle_id: u32) -> Result<()> {
    let raffle = &mut ctx.accounts.raffle;
    let creator = &ctx.accounts.creator;
    let now = Clock::get()?.unix_timestamp;

    require!(
        matches!(
            raffle.status,
            RaffleState::FailedEnded | RaffleState::SuccessEnded
        ),
        RaffleStateErrors::RaffleNotEnded
    );

    let prize_amount_claimable = raffle.claimable_prize_back;
    let ticket_amount_claimable = raffle.claimable_ticket_amount;

    require!(
        prize_amount_claimable > 0 || ticket_amount_claimable > 0,
        RaffleStateErrors::InvalidZeroAmount
    );

    // PDA seeds for signing transfers
    let seeds: &[&[u8]] = &[
        b"raffle",
        &raffle.raffle_id.to_le_bytes(),
        &[raffle.raffle_bump],
    ];
    let signer_seeds = &[seeds];

    // --- Claim back leftover prize (FailedEnded or under-sold) ---
    if prize_amount_claimable > 0 {
        match raffle.prize_type {
            PrizeType::Sol => {
                transfer_sol_with_seeds(
                    &raffle.to_account_info(),
                    &creator.to_account_info(),
                    &ctx.accounts.system_program,
                    signer_seeds,
                    prize_amount_claimable,
                )?;
            }
            PrizeType::Nft | PrizeType::Spl => {
                let stored_prize_mint = raffle
                    .prize_mint
                    .ok_or(KeysMismatchErrors::MissingPrizeMint)?;
                let stored_prize_escrow = raffle
                    .prize_escrow
                    .ok_or(KeysMismatchErrors::MissingPrizeEscrow)?;

                // Validate stored keys
                require_keys_eq!(
                    ctx.accounts.prize_mint.key(),
                    stored_prize_mint,
                    KeysMismatchErrors::InvalidPrizeMint
                );

                // Validate prize escrow
                let escrow = &ctx.accounts.prize_escrow;
                require_keys_eq!(
                    escrow.key(),
                    stored_prize_escrow,
                    KeysMismatchErrors::InvalidPrizeEscrow
                );
                require_keys_eq!(
                    escrow.owner,
                    raffle.key(),
                    KeysMismatchErrors::InvalidPrizeEscrowOwner
                );
                require_keys_eq!(
                    escrow.mint,
                    stored_prize_mint,
                    KeysMismatchErrors::InvalidPrizeMint
                );

                // Final ATA validation
                let creator_ata = &ctx.accounts.creator_prize_ata;
                require_keys_eq!(
                    creator_ata.mint,
                    stored_prize_mint,
                    KeysMismatchErrors::InvalidPrizeMint
                );

                // Amount: NFT = 1, SPL = prize_amount_claimable
                let amount = if raffle.prize_type == PrizeType::Nft {
                    1u64
                } else {
                    prize_amount_claimable
                };

                transfer_tokens_with_seeds(
                    escrow,
                    creator_ata,
                    &raffle.to_account_info(),
                    &ctx.accounts.prize_token_program,
                    &ctx.accounts.prize_mint,
                    signer_seeds,
                    amount,
                )?;
            }
        }
    }

    // --- Claim ticket revenue (after platform fee) ---
    if ticket_amount_claimable > 0 {
        if raffle.ticket_mint.is_none() {
            // SOL ticket revenue
            transfer_sol_with_seeds(
                &raffle.to_account_info(),
                &creator.to_account_info(),
                &ctx.accounts.system_program,
                signer_seeds,
                ticket_amount_claimable,
            )?;
        } else {
            // SPL ticket revenue
            let stored_ticket_mint = raffle
                .ticket_mint
                .ok_or(KeysMismatchErrors::MissingTicketMint)?;
            let stored_ticket_escrow = raffle
                .ticket_escrow
                .ok_or(KeysMismatchErrors::MissingTicketEscrow)?;

            // Validate ticket mint
            require_keys_eq!(
                ctx.accounts.ticket_mint.key(),
                stored_ticket_mint,
                KeysMismatchErrors::InvalidTicketMint
            );

            // Validate ticket escrow
            let escrow = &ctx.accounts.ticket_escrow;
            require_keys_eq!(
                escrow.key(),
                stored_ticket_escrow,
                KeysMismatchErrors::InvalidTicketEscrow
            );
            require_keys_eq!(
                escrow.owner,
                raffle.key(),
                KeysMismatchErrors::InvalidTicketAtaOwner
            );
            require_keys_eq!(
                escrow.mint,
                stored_ticket_mint,
                KeysMismatchErrors::InvalidTicketMint
            );

            // Final ATA validation
            let creator_ata = &ctx.accounts.creator_ticket_ata;
            require_keys_eq!(
                creator_ata.mint,
                stored_ticket_mint,
                KeysMismatchErrors::InvalidTicketMint
            );

            transfer_tokens_with_seeds(
                escrow,
                creator_ata,
                &raffle.to_account_info(),
                &ctx.accounts.ticket_token_program,
                &ctx.accounts.ticket_mint,
                signer_seeds,
                ticket_amount_claimable,
            )?;
        }
    }

    // --- Reset claimable amounts (prevent double claim) ---
    raffle.claimable_prize_back = 0;
    raffle.claimable_ticket_amount = 0;

    // --- Emit event ---
    emit!(AmountClaimBack {
        raffle_id,
        claimer: creator.key(),
        prize_amount_claimable,
        ticket_amount_claimable,
        claimed_time: now,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(raffle_id: u32)]
pub struct ClaimAmountBack<'info> {
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
        constraint = creator.key() == raffle.creator @ RaffleStateErrors::InvalidCreator,
    )]
    pub creator: Signer<'info>,

    pub raffle_admin: Signer<'info>,

    // Prize mint for SPL/NFT (unused for SOL)
    pub prize_mint: InterfaceAccount<'info, Mint>,

    // Ticket mint for SPL (unused for SOL)
    pub ticket_mint: InterfaceAccount<'info, Mint>,

    // Prize escrow ATA owned by raffle PDA (for SPL/NFT)
    #[account(mut)]
    pub prize_escrow: InterfaceAccount<'info, TokenAccount>,

    // Ticket escrow ATA owned by raffle PDA (for SPL)
    #[account(mut)]
    pub ticket_escrow: InterfaceAccount<'info, TokenAccount>,

    // Creator ATA for prize mint (may be created if missing)
    #[account(mut)]
    pub creator_prize_ata: InterfaceAccount<'info, TokenAccount>,

    // Creator ATA for ticket mint (may be created if missing)
    #[account(mut)]
    pub creator_ticket_ata: InterfaceAccount<'info, TokenAccount>,

    pub prize_token_program: Interface<'info, TokenInterface>,
    pub ticket_token_program: Interface<'info, TokenInterface>,

    pub system_program: Program<'info, System>,
}
