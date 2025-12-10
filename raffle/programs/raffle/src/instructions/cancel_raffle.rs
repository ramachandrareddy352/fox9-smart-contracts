use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    close_account, CloseAccount, Mint, TokenAccount, TokenInterface,
};
use crate::constants::CANCEL_RAFFLE_PAUSE;
use crate::errors::*;
use crate::helpers::*;
use crate::states::*;
use crate::utils::is_paused;

#[event]
pub struct RaffleCancelled {
    pub raffle_id: u32,
    pub cancelled_by: Pubkey,
    pub cancelled_time: i64,
} 

pub fn cancel_raffle(ctx: Context<CancelRaffle>, _raffle_id: u32) -> Result<()> {
    require!(
        !is_paused(ctx.accounts.raffle_config.pause_flags, CANCEL_RAFFLE_PAUSE),
        RaffleStateErrors::FunctionPaused
    );

    let raffle = &mut ctx.accounts.raffle;
    let creator = &ctx.accounts.creator;

    // Only allow cancel when in Initialized or Active state
    require!(
        raffle.status == RaffleState::Initialized || raffle.status == RaffleState::Active,
        RaffleStateErrors::InvalidRaffleStateForCancel
    );

    // No tickets must have been sold
    require_eq!(
        raffle.tickets_sold,
        0,
        RaffleStateErrors::MoreThanOneTicketSolded
    );

    // Refund prize to creator (but NOT creation fee)
    let prize_amount = raffle.prize_amount;
 
    // Seeds for raffle PDA signing (same as in create_raffle)
    let raffle_id_bytes = raffle.raffle_id.to_le_bytes(); // binding
    let seeds: &[&[u8]] = &[b"raffle", &raffle_id_bytes, &[raffle.raffle_bump]];
    let signer_seeds: &[&[&[u8]]] = &[&seeds];

    raffle.status = RaffleState::Cancelled;

    match raffle.prize_type {
        PrizeType::Sol => {
            // Prize is in SOL stored on the raffle PDA.
            // Transfer only `prize_amount` back to creator.
            let from = raffle.to_account_info();
            let to = creator.to_account_info();

            require!(from.lamports() > prize_amount, TransferErrors::InsufficientSolBalance);

            **from.try_borrow_mut_lamports()? -= prize_amount;
            **to.try_borrow_mut_lamports()? += prize_amount;
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

            // --- Determine amount to return ---
            let return_amount = if raffle.prize_type == PrizeType::Nft {
                1u64
            } else {
                // all dust amount also sent to creator
                raffle.prize_amount.max(prize_escrow.amount)
            };
            require_gt!(return_amount, 0, RaffleStateErrors::InvalidZeroAmount);

            // --- SAFE TOKEN TRANSFER (with mint + decimals) ---
            transfer_tokens_with_seeds(
                prize_escrow,
                creator_prize_ata,
                &raffle.to_account_info(),
                &ctx.accounts.prize_token_program,
                prize_mint,
                signer_seeds,
                return_amount,
            )?;

            // --- CLOSE ESCROW ATA & RETURN RENT to creator ---
            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.prize_token_program.to_account_info(),
                CloseAccount {
                    account: prize_escrow.to_account_info(),
                    destination: creator.to_account_info(),
                    authority: raffle.to_account_info(),
                },
                signer_seeds,
            );

            close_account(cpi_ctx)?;
        }
    }

    emit!(RaffleCancelled {
        raffle_id: raffle.raffle_id,
        cancelled_by: creator.key(),
        cancelled_time: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(raffle_id: u32)]
pub struct CancelRaffle<'info> {
    #[account(
        seeds = [b"raffle"],
        bump = raffle_config.config_bump,
        constraint = raffle_config.raffle_admin == raffle_admin.key() @ ConfigStateErrors::InvalidRaffleAdmin,
    )]
    pub raffle_config: Box<Account<'info, RaffleConfig>>,

    #[account(
        mut,
        close = creator,
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

    // Prize mint (SPL / NFT) – used for ATA creation/validation.
    // Required only when prize_type is SPL or NFT.
    pub prize_mint: InterfaceAccount<'info, Mint>,

    // Prize escrow ATA (SPL / NFT) owned by raffle PDA.
    // Required only when prize_type is SPL or NFT.
    #[account(mut)]
    pub prize_escrow: InterfaceAccount<'info, TokenAccount>,

    // Creator's ATA for the prize mint (SPL / NFT).
    // Required only when prize_type is SPL or NFT.
    #[account(mut)]
    pub creator_prize_ata: InterfaceAccount<'info, TokenAccount>,

    // Token program used for prize SPL/NFT transfers
    pub prize_token_program: Interface<'info, TokenInterface>,

    pub system_program: Program<'info, System>,
}
