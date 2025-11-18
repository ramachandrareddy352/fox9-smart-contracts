use crate::errors::RaffleErrors;
use crate::states::{PrizeType, Raffle, RaffleConfig, RaffleState};
use crate::transfer_helpers::*;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{TokenAccount, TokenInterface};

pub fn cancel_raffle(ctx: Context<CancelRaffle>, raffle_id: u32) -> Result<()> {
    let raffle_config = &ctx.accounts.raffle_config;
    let raffle = &mut ctx.accounts.raffle;
    let creator = &ctx.accounts.creator;

    // basic checks of ownership
    require_eq!(raffle.raffle_id, raffle_id, RaffleErrors::InvalidRaffleId);
    require_keys_eq!(raffle.creator, creator.key(), RaffleErrors::InvalidCreator);

    // Only allow cancel when in Initialized or Active state
    require!(
        raffle.status == RaffleState::Initialized || raffle.status == RaffleState::Active,
        RaffleErrors::InvalidRaffleStateForCancel
    );

    // No tickets must have been sold
    require_eq!(raffle.tickets_sold, 0, RaffleErrors::TicketsAlreadySold);

    // 3. Refund prize to creator (but NOT creation fee)
    let prize_amount = raffle.prize_amount;
    let raffle_ai = raffle.to_account_info();

    // Seeds for raffle PDA signing (same as in create_raffle)
    let raffle_seeds: &[&[u8]] = &[
        b"raffle",
        &raffle.raffle_id.to_le_bytes(),
        &[raffle.raffle_bump],
    ];
    let signer_seeds: &[&[&[u8]]] = &[raffle_seeds];

    match raffle.prize_type {
        PrizeType::Sol => {
            // Prize is in SOL stored on the raffle PDA.
            // Transfer only `prize_amount` back to creator.
            transfer_sol_with_seeds(
                &raffle_ai,
                &creator.to_account_info(),
                &ctx.accounts.system_program,
                signer_seeds,
                prize_amount,
            )?;
        }
        PrizeType::Nft | PrizeType::Spl => {
            let prize_escrow = &ctx.accounts.prize_escrow;
            let creator_prize_ata = &ctx.accounts.creator_prize_ata;
            let prize_token_program = &ctx.accounts.prize_token_program;

            // Ensure raffle expects a prize mint / escrow
            let expected_prize_mint = raffle.prize_mint.ok_or(RaffleErrors::MissingPrizeMint)?;
            let expected_escrow = raffle
                .price_escrow
                .ok_or(RaffleErrors::MissingPrizeEscrow)?;

            // Escrow account must match what raffle stored
            require_keys_eq!(
                prize_escrow.key(),
                expected_escrow,
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
                expected_prize_mint,
                RaffleErrors::InvalidPrizeMint
            );

            /// INFO: Creator can give any PDA to receive the amount back
            // Creator ATA must be owned by creator
            // require_keys_eq!(
            //     creator_prize_ata.owner,
            //     creator.key(),
            //     RaffleErrors::InvalidCreatorPrizeAtaOwner
            // );

            // Creator ATA mint must match prize mint
            require_keys_eq!(
                creator_prize_ata.mint,
                expected_prize_mint,
                RaffleErrors::InvalidCreatorPrizeAtaMint
            );

            // Transfer SPL / NFT prize back to creator from escrow using raffle PDA as authority
            transfer_tokens_with_seeds(
                prize_escrow,
                creator_prize_ata,
                &raffle_ai,
                prize_token_program,
                signer_seeds,
                prize_amount,
            )?;
        }
    }

    raffle.status = RaffleState::Cancelled;

    emit!(RaffleCancelled {
        raffle_id: raffle.raffle_id,
        cancelled_by: creator.key(),
        prize_type: raffle.prize_type,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(raffle_id: u32)]
pub struct CancelRaffle<'info> {
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
    )]
    pub raffle: Box<Account<'info, Raffle>>,

    #[account(
        mut,
        constraint = creator.key() == raffle.creator @ RaffleErrors::InvalidCreator,
    )]
    pub creator: Signer<'info>,

    #[account(mut)]
    pub raffle_admin: Signer<'info>,

    /// Prize escrow ATA (SPL / NFT) owned by raffle PDA.
    /// Required only when prize_type is SPL or NFT.
    #[account(mut)]
    pub prize_escrow: InterfaceAccount<'info, TokenAccount>,

    /// Creator's ATA for the prize mint (SPL / NFT).
    /// Required only when prize_type is SPL or NFT.
    #[account(mut)]
    pub creator_prize_ata: InterfaceAccount<'info, TokenAccount>,

    /// Token program used for prize SPL/NFT transfers
    pub prize_token_program: Interface<'info, TokenInterface>,

    pub system_program: Program<'info, System>,
}
