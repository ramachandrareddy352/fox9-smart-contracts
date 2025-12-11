use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    close_account, CloseAccount, Mint, TokenAccount, TokenInterface,
};
use crate::constants::CLAIM_AMOUNT_BACK_PAUSE;
use crate::errors::*;
use crate::helpers::*;
use crate::states::*;
use crate::utils::is_paused;

#[event]
pub struct AmountClaimBack {
    pub raffle_id: u32,
    pub claimer: Pubkey,
    pub prize_amount_claimable: u64,
    pub ticket_amount_claimable: u64,
    pub claimed_time: i64,
}

pub fn claim_amount_back(ctx: Context<ClaimAmountBack>, raffle_id: u32) -> Result<()> {
    require!(
        !is_paused(
            ctx.accounts.raffle_config.pause_flags,
            CLAIM_AMOUNT_BACK_PAUSE
        ),
        RaffleStateErrors::FunctionPaused
    );

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
    let ticket_amount_claimable = raffle
        .claimable_ticket_amount
        .max(ctx.accounts.ticket_escrow.amount); // remove all the dust to claim, the fees are already claimed, so we can clean all of them and close the account

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
                // transfer the sol prize to CREATOR
                require!(raffle.to_account_info().lamports() > prize_amount_claimable, TransferErrors::InsufficientSolBalance);

                **raffle.to_account_info().try_borrow_mut_lamports()? -= prize_amount_claimable;
                **creator.to_account_info().try_borrow_mut_lamports()? += prize_amount_claimable;
            }
            PrizeType::Nft | PrizeType::Spl => {
                let stored_prize_mint = raffle
                    .prize_mint
                    .ok_or(KeysMismatchErrors::MissingPrizeMint)?;

                let prize_mint = &ctx.accounts.prize_mint;
                let prize_escrow = &ctx.accounts.prize_escrow;
                let creator_prize_ata = &ctx.accounts.creator_prize_ata;

                require!(
                    prize_mint.key() == stored_prize_mint
                        && creator_prize_ata.mint == stored_prize_mint
                        && prize_escrow.mint == stored_prize_mint,
                    KeysMismatchErrors::InvalidPrizeMint
                );
                require_keys_eq!(
                    prize_escrow.owner,
                    raffle.key(),
                    KeysMismatchErrors::InvalidPrizeEscrowOwner
                );
                require_keys_eq!(
                    creator_prize_ata.owner,
                    creator.key(),
                    KeysMismatchErrors::InvalidPrizeAtaOwner
                );

                // Amount: NFT = 1, SPL = prize_amount_claimable
                let amount = if raffle.prize_type == PrizeType::Nft {
                    1u64
                } else {
                    prize_amount_claimable
                };

                transfer_tokens_with_seeds(
                    prize_escrow,
                    creator_prize_ata,
                    &raffle.to_account_info(),
                    &ctx.accounts.prize_token_program,
                    prize_mint,
                    signer_seeds,
                    amount,
                )?;
            }
        }
    }

    // --- Claim ticket revenue (after platform fee) ---
    if ticket_amount_claimable > 0 {
        if raffle.ticket_mint.is_none() {
            // transfer the sol tickets to CREATOR
            require!(raffle.to_account_info().lamports() > ticket_amount_claimable, TransferErrors::InsufficientSolBalance);

            **raffle.to_account_info().try_borrow_mut_lamports()? -= ticket_amount_claimable;
            **creator.to_account_info().try_borrow_mut_lamports()? += ticket_amount_claimable;
        } else {
            // SPL ticket revenue
            let stored_ticket_mint = raffle
                .ticket_mint
                .ok_or(KeysMismatchErrors::MissingTicketMint)?;

            let ticket_mint = &ctx.accounts.ticket_mint;
            let ticket_escrow = &ctx.accounts.ticket_escrow;
            let creator_ticket_ata = &ctx.accounts.creator_ticket_ata;

            require!(
                ticket_mint.key() == stored_ticket_mint
                    && creator_ticket_ata.mint == stored_ticket_mint
                    && ticket_escrow.mint == stored_ticket_mint,
                KeysMismatchErrors::InvalidTicketMint
            );
            require_keys_eq!(
                ticket_escrow.owner,
                raffle.key(),
                KeysMismatchErrors::InvalidTicketEscrowOwner
            );
            require_keys_eq!(
                creator_ticket_ata.owner,
                creator.key(),
                KeysMismatchErrors::InvalidTicketAtaOwner
            );

            transfer_tokens_with_seeds(
                ticket_escrow,
                creator_ticket_ata,
                &raffle.to_account_info(),
                &ctx.accounts.ticket_token_program,
                ticket_mint,
                signer_seeds,
                ticket_amount_claimable,
            )?;

            // --- CLOSE ESCROW ATA & RETURN RENT to creator ---
            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.ticket_token_program.to_account_info(), // token_program
                CloseAccount {
                    account: ticket_escrow.to_account_info(),
                    destination: creator.to_account_info(),
                    authority: raffle.to_account_info(),
                },
                signer_seeds,
            );

            close_account(cpi_ctx)?;
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
