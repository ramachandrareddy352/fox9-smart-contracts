use crate::errors::RaffleErrors;
use crate::helpers::*;
use crate::states::{PrizeType, Raffle, RaffleConfig, RaffleState};
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

pub fn creator_claim_amount_back(
    ctx: Context<CreatorClaimAmountBack>,
    raffle_id: u32,
) -> Result<()> {
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
    let prize_amount_claimable = raffle.claimable_prize_back;
    let ticket_amount_claimable = raffle.claimable_ticket_amount;
    require!(
        prize_amount_claimable > 0 || ticket_amount_claimable > 0,
        RaffleErrors::NoClaimableAmounts
    );

    // Signer seeds for raffle PDA (authority of escrow / SOL)
    let raffle_ai = raffle.to_account_info();
    let signer_seeds: &[&[&[u8]]] = &[&[
        b"raffle",
        &raffle.raffle_id.to_le_bytes(),
        &[raffle.raffle_bump],
    ]];

    // Claim prize back (leftover prize)
    if prize_amount_claimable > 0 {
        match raffle.prize_type {
            PrizeType::Sol => {
                // SOL: transfer lamports from raffle PDA -> creator
                transfer_sol_with_seeds(
                    &raffle_ai,
                    &creator.to_account_info(),
                    &ctx.accounts.system_program,
                    signer_seeds,
                    prize_amount_claimable,
                )?;
            }
            PrizeType::Nft | PrizeType::Spl => {
                // Deserialize accounts for validation and CPI
                let prize_escrow = InterfaceAccount::<TokenAccount>::try_from(
                    &ctx.accounts.prize_escrow.to_account_info(),
                )?;
                let prize_mint_acc =
                    InterfaceAccount::<Mint>::try_from(&ctx.accounts.prize_mint.to_account_info())?;
                let prize_token_program = InterfaceAccount::<TokenInterface>::try_from(
                    &ctx.accounts.prize_token_program.to_account_info(),
                )?;
                let creator_prize_ata_raw = &ctx.accounts.creator_prize_ata.to_account_info();

                let stored_mint = raffle.prize_mint.ok_or(RaffleErrors::MissingPrizeMint)?;

                // Stored mint must match provided mint
                require_keys_eq!(
                    prize_mint_acc.key(),
                    stored_mint,
                    RaffleErrors::InvalidPrizeMint
                );

                // Stored escrow must match provided escrow
                let stored_escrow = raffle
                    .prize_escrow
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

                // Mint of escrow must match prize_mint
                require_keys_eq!(
                    prize_escrow.mint,
                    stored_mint,
                    RaffleErrors::InvalidPrizeMint
                );

                // Validate token program
                require_keys_eq!(
                    prize_escrow.token_program,
                    prize_token_program.key(),
                    RaffleErrors::InvalidTokenProgram
                );

                // Ensure creator ATA is the correct ATA for (creator, prize_mint)
                // If not present, create it.
                create_ata(
                    &creator.to_account_info(),
                    creator_prize_ata_raw,
                    &creator.to_account_info(),
                    &ctx.accounts.prize_mint.to_account_info(),
                    &ctx.accounts.system_program.to_account_info(),
                    &ctx.accounts.prize_token_program.to_account_info(),
                    &ctx.accounts.associated_token_program.to_account_info(),
                )?;

                // Deserialize creator_prize_ata after potential creation
                let creator_prize_ata =
                    InterfaceAccount::<TokenAccount>::try_from(creator_prize_ata_raw)?;

                // Creator ATA must be owned by creator
                require_keys_eq!(
                    creator_prize_ata.owner,
                    creator.key(),
                    RaffleErrors::InvalidCreatorPrizeAtaOwner
                );

                // Creator ATA mint must match prize mint
                require_keys_eq!(
                    creator_prize_ata.mint,
                    stored_mint,
                    RaffleErrors::InvalidCreatorPrizeAtaMint
                );

                // Transfer SPL/NFT tokens from escrow -> creator ATA via raffle PDA authority
                transfer_tokens_with_seeds(
                    &prize_escrow,
                    &creator_prize_ata,
                    &raffle_ai,
                    &prize_token_program,
                    signer_seeds,
                    prize_amount_claimable,
                )?;
            }
        }
    }

    // Claim ticket revenue back (leftover tickets after fees)
    if ticket_amount_claimable > 0 {
        if raffle.ticket_mint.is_none() {
            // SOL tickets: transfer lamports from raffle PDA -> creator
            transfer_sol_with_seeds(
                &raffle_ai,
                &creator.to_account_info(),
                &ctx.accounts.system_program,
                signer_seeds,
                ticket_amount_claimable,
            )?;
        } else {
            // SPL tickets: transfer tokens from ticket_escrow -> creator_ticket_ata
            // Deserialize accounts for validation and CPI
            let ticket_escrow = InterfaceAccount::<TokenAccount>::try_from(
                &ctx.accounts.ticket_escrow.to_account_info(),
            )?;
            let ticket_mint_acc =
                InterfaceAccount::<Mint>::try_from(&ctx.accounts.ticket_mint.to_account_info())?;
            let ticket_token_program = InterfaceAccount::<TokenInterface>::try_from(
                &ctx.accounts.ticket_token_program.to_account_info(),
            )?;
            let creator_ticket_ata_raw = &ctx.accounts.creator_ticket_ata.to_account_info();

            let stored_ticket_mint = raffle.ticket_mint.ok_or(RaffleErrors::MissingTicketMint)?;

            // Stored mint must match provided mint
            require_keys_eq!(
                ticket_mint_acc.key(),
                stored_ticket_mint,
                RaffleErrors::InvalidTicketMint
            );

            // Stored escrow must match provided escrow
            let stored_escrow = raffle
                .ticket_escrow
                .ok_or(RaffleErrors::MissingTicketEscrow)?;
            require_keys_eq!(
                ticket_escrow.key(),
                stored_escrow,
                RaffleErrors::InvalidTicketEscrow
            );

            // Escrow must be owned by raffle PDA
            require_keys_eq!(
                ticket_escrow.owner,
                raffle.key(),
                RaffleErrors::InvalidTicketEscrowOwner
            );

            // Mint of escrow must match ticket_mint
            require_keys_eq!(
                ticket_escrow.mint,
                stored_ticket_mint,
                RaffleErrors::InvalidTicketMint
            );

            // Validate token program
            require_keys_eq!(
                ticket_escrow.token_program,
                ticket_token_program.key(),
                RaffleErrors::InvalidTokenProgram
            );

            // Ensure creator_ticket_ata is the correct ATA for (creator, ticket_mint)
            // If not present, create it.
            create_ata(
                &creator.to_account_info(),
                creator_ticket_ata_raw,
                &creator.to_account_info(),
                &ctx.accounts.ticket_mint.to_account_info(),
                &ctx.accounts.system_program.to_account_info(),
                &ctx.accounts.ticket_token_program.to_account_info(),
                &ctx.accounts.associated_token_program.to_account_info(),
            )?;

            // Deserialize creator_ticket_ata after potential creation
            let creator_ticket_ata =
                InterfaceAccount::<TokenAccount>::try_from(creator_ticket_ata_raw)?;

            // Creator ATA must be owned by creator
            require_keys_eq!(
                creator_ticket_ata.owner,
                creator.key(),
                RaffleErrors::InvalidCreatorTicketAtaOwner
            );

            // Creator ATA mint must match ticket mint
            require_keys_eq!(
                creator_ticket_ata.mint,
                stored_ticket_mint,
                RaffleErrors::InvalidCreatorTicketAtaMint
            );

            // Transfer SPL tokens from ticket_escrow -> creator_ticket_ata via raffle PDA authority
            transfer_tokens_with_seeds(
                &ticket_escrow,
                &creator_ticket_ata,
                &raffle_ai,
                &ticket_token_program,
                signer_seeds,
                ticket_amount_claimable,
            )?;
        }
    }

    // Reset claimable amounts so it can't be claimed again
    raffle.claimable_prize_back = 0;
    raffle.claimable_ticket_amount = 0;

    Ok(())
}

#[derive(Accounts)]
#[instruction(raffle_id: u32)]
pub struct CreatorClaimAmountBack<'info> {
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

    pub raffle_admin: Signer<'info>,

    /// Prize mint for SPL/NFT (unused for SOL)
    pub prize_mint: UncheckedAccount<'info>,

    /// Ticket mint for SPL (unused for SOL)
    pub ticket_mint: UncheckedAccount<'info>,

    /// Prize escrow ATA owned by raffle PDA (for SPL/NFT)
    #[account(mut)]
    pub prize_escrow: UncheckedAccount<'info>,

    /// Ticket escrow ATA owned by raffle PDA (for SPL)
    #[account(mut)]
    pub ticket_escrow: UncheckedAccount<'info>,

    /// Creator ATA for prize mint (may be created if missing)
    #[account(mut)]
    pub creator_prize_ata: UncheckedAccount<'info>,

    /// Creator ATA for ticket mint (may be created if missing)
    #[account(mut)]
    pub creator_ticket_ata: UncheckedAccount<'info>,

    pub prize_token_program: UncheckedAccount<'info>,
    pub ticket_token_program: UncheckedAccount<'info>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
