use crate::errors::RaffleErrors;
use crate::raffle_math::{has_duplicate_pubkeys, is_descending_order_and_sum_100, TOTAL_PCT};
use crate::states::{PrizeType, Raffle, RaffleConfig, RaffleState};
use anchor_lang::prelude::*;

pub fn announce_winner(
    ctx: Context<AnnounceWinner>,
    raffle_id: u32,
    winners: Vec<Pubkey>,
) -> Result<()> {
    let raffle_config = &ctx.accounts.raffle_config;
    let raffle = &mut ctx.accounts.raffle;
    let raffle_admin = &ctx.accounts.raffle_admin;

    // ---------- Validations ----------
    require_eq!(raffle.raffle_id, raffle_id, RaffleErrors::InvalidRaffleId);
    require!(
        raffle.status == RaffleState::Active,
        RaffleErrors::RaffleNotActive
    );

    let now = Clock::get()?.unix_timestamp;
    require_gte!(now, raffle.end_time, RaffleErrors::RaffleNotEnded);

    let tickets_sold = raffle.tickets_sold as u64;
    let num_winners_cfg = raffle.num_winners as usize;

    // ---------- If zero tickets sold (FAILED) ----------
    if tickets_sold == 0 {
        raffle.status = RaffleState::FailedEnded;

        raffle.claimable_prize_back = match raffle.prize_type {
            PrizeType::Nft => 1,
            _ => raffle.prize_amount,
        };

        // No transfers here since creation fee non-refundable
        return Ok(());
    }

    // ---------------- NFT Only ----------------
    if raffle.prize_type == PrizeType::Nft {
        require!(winners.len() == 1, RaffleErrors::InvalidWinnersLength);

        raffle.winners = winners;
        raffle.is_win_claimed = vec![false; 1];
        raffle.claimable_prize_back = 0;
        raffle.status = RaffleState::SuccessEnded;

        // --- PROCESS TICKET REVENUE TRANSFERS ---
        process_ticket_revenue(&ctx, tickets_sold)?;

        emit!(WinnersAnnounced {
            raffle_id: raffle.raffle_id,
            total_tickets_sold: tickets_sold as u16,
            effective_winners: 1,
            claimable_prize_back: 0,
        });

        return Ok(());
    }

    // ---------------- SPL or SOL Prize Path ----------------

    let sold_usize = tickets_sold as usize;
    let actual_winners = sold_usize.min(num_winners_cfg);
    require!(
        winners.len() == actual_winners,
        RaffleErrors::InvalidWinnersLength
    );

    if raffle.is_unique_winners {
        require!(
            !has_duplicate_pubkeys(&winners),
            RaffleErrors::DuplicateWinnersNotAllowed
        );
    }

    let mut claimable_back: u64 = 0;
    let total_pct = TOTAL_PCT as u64;

    if sold_usize < num_winners_cfg {
        let assigned_pct: u64 = raffle
            .win_shares
            .iter()
            .take(actual_winners)
            .map(|&s| s as u64)
            .sum();
        require!(assigned_pct <= total_pct, RaffleErrors::InvalidWinShares);

        let leftover_pct = total_pct
            .checked_sub(assigned_pct)
            .ok_or(RaffleErrors::Overflow)?;

        claimable_back = raffle
            .prize_amount
            .checked_mul(leftover_pct)
            .ok_or(RaffleErrors::Overflow)?
            .checked_div(total_pct)
            .ok_or(RaffleErrors::Overflow)?;
    }

    raffle.claimable_prize_back = claimable_back;
    raffle.winners = winners;
    raffle.is_win_claimed = vec![false; actual_winners];
    raffle.status = RaffleState::SuccessEnded;

    // Process revenue transfers → fees + creator
    process_ticket_revenue(&ctx, tickets_sold)?;

    emit!(WinnersAnnounced {
        raffle_id: raffle.raffle_id,
        total_tickets_sold: tickets_sold as u16,
        effective_winners: actual_winners as u8,
        claimable_prize_back,
    });

    Ok(())
}

use crate::errors::RaffleErrors;
use crate::raffle_math::{has_duplicate_pubkeys, is_descending_order_and_sum_100, TOTAL_PCT};
use crate::states::{PrizeType, Raffle, RaffleConfig, RaffleState};
use crate::transfer_helpers::{create_ata, transfer_sol_with_seeds};
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{transfer, Mint, TokenAccount, TokenInterface, Transfer};

pub fn announce_winner(
    ctx: Context<AnnounceWinner>,
    raffle_id: u32,
    winners: Vec<Pubkey>,
) -> Result<()> {
    let raffle_config = &ctx.accounts.raffle_config;
    let raffle = &mut ctx.accounts.raffle;

    // ---------- Validations ----------
    require_eq!(raffle.raffle_id, raffle_id, RaffleErrors::InvalidRaffleId);
    require!(
        raffle.status == RaffleState::Active,
        RaffleErrors::RaffleNotActive
    );

    let now = Clock::get()?.unix_timestamp;
    require_gte!(now, raffle.end_time, RaffleErrors::RaffleNotEnded);

    let tickets_sold = raffle.tickets_sold as u64;
    let num_winners_cfg = raffle.num_winners as usize;

    // ---------- If zero tickets sold (FAILED) ----------
    if tickets_sold == 0 {
        raffle.status = RaffleState::FailedEnded;

        raffle.claimable_prize_back = match raffle.prize_type {
            PrizeType::Nft => 1,
            _ => raffle.prize_amount,
        };

        return Ok(());
    }

    // ---------------- NFT Only ----------------
    if raffle.prize_type == PrizeType::Nft {
        require!(winners.len() == 1, RaffleErrors::InvalidWinnersLength);

        raffle.winners = winners;
        raffle.is_win_claimed = vec![false; 1];
        raffle.claimable_prize_back = 0;
        raffle.status = RaffleState::SuccessEnded;

        // --- PROCESS TICKET REVENUE TRANSFERS ---
        process_ticket_revenue(&ctx, tickets_sold)?;

        emit!(WinnersAnnounced {
            raffle_id: raffle.raffle_id,
            total_tickets_sold: tickets_sold as u16,
            effective_winners: 1,
            claimable_prize_back: 0,
        });

        return Ok(());
    }

    // ---------------- SPL or SOL Prize Path ----------------

    let sold_usize = tickets_sold as usize;
    let actual_winners = sold_usize.min(num_winners_cfg);
    require!(
        winners.len() == actual_winners,
        RaffleErrors::InvalidWinnersLength
    );

    if raffle.is_unique_winners {
        require!(
            !has_duplicate_pubkeys(&winners),
            RaffleErrors::DuplicateWinnersNotAllowed
        );
    }

    let mut claimable_back: u64 = 0;
    let total_pct = TOTAL_PCT as u64;

    if sold_usize < num_winners_cfg {
        let assigned_pct: u64 = raffle
            .win_shares
            .iter()
            .take(actual_winners)
            .map(|&s| s as u64)
            .sum();
        require!(assigned_pct <= total_pct, RaffleErrors::InvalidWinShares);

        let leftover_pct = total_pct
            .checked_sub(assigned_pct)
            .ok_or(RaffleErrors::Overflow)?;

        claimable_back = raffle
            .prize_amount
            .checked_mul(leftover_pct)
            .ok_or(RaffleErrors::Overflow)?
            .checked_div(total_pct)
            .ok_or(RaffleErrors::Overflow)?;
    }

    raffle.claimable_prize_back = claimable_back;
    raffle.winners = winners;
    raffle.is_win_claimed = vec![false; actual_winners];
    raffle.status = RaffleState::SuccessEnded;

    // Process revenue transfers → fees + creator
    process_ticket_revenue(&ctx, tickets_sold)?;

    emit!(WinnersAnnounced {
        raffle_id: raffle.raffle_id,
        total_tickets_sold: tickets_sold as u16,
        effective_winners: actual_winners as u8,
        claimable_prize_back,
    });

    Ok(())
}

fn process_ticket_revenue<'info>(ctx: &Context<AnnounceWinner>, tickets_sold: u64) -> Result<()> {
    let raffle = &ctx.accounts.raffle;
    let raffle_config = &ctx.accounts.raffle_config;
    let creator = &ctx.accounts.raffle_creator;
    let system_program = &ctx.accounts.system_program;

    let total_revenue = raffle
        .ticket_price
        .checked_mul(tickets_sold)
        .ok_or(RaffleErrors::Overflow)?;

    let fee_amount = total_revenue
        .checked_mul(raffle_config.ticket_fee_bps as u64)
        .ok_or(RaffleErrors::Overflow)?
        .checked_div(10_000)
        .ok_or(RaffleErrors::Overflow)?;

    let creator_amount = total_revenue
        .checked_sub(fee_amount)
        .ok_or(RaffleErrors::Overflow)?;

    // PDA signer seeds
    let raffle_ai = raffle.to_account_info();
    let seeds: &[&[u8]] = &[
        b"raffle",
        &raffle.raffle_id.to_le_bytes(),
        &[raffle.raffle_bump],
    ];
    let signer_seeds: &[&[&[u8]]] = &[seeds];

    match raffle.ticket_mint {
        // --------------------------------------------------
        // SOL tickets → send lamports
        // fee: to raffle_config PDA (fee_treasury must equal raffle_config)
        // creator: to raffle creator
        // --------------------------------------------------
        None => {
            // Fee treasury must be raffle_config PDA
            require_keys_eq!(
                ctx.accounts.fee_treasury.key(),
                raffle_config.key(),
                RaffleErrors::InvalidFeeTreasury
            );

            transfer_sol_with_seeds(
                &raffle_ai,
                &ctx.accounts.fee_treasury.to_account_info(),
                system_program,
                signer_seeds,
                fee_amount,
            )?;

            transfer_sol_with_seeds(
                &raffle_ai,
                &creator.to_account_info(),
                system_program,
                signer_seeds,
                creator_amount,
            )?;
        }

        // --------------------------------------------------
        // SPL tickets → move tokens from ticket_escrow (raffle PDA ATA)
        // fee: to ATA owned by raffle_config PDA
        // creator: to ATA owned by creator
        // --------------------------------------------------
        Some(stored_ticket_mint) => {
            let escrow = &ctx.accounts.ticket_escrow;
            let token_program = &ctx.accounts.token_program;
            let creator_ata = &ctx.accounts.creator_ticket_ata;
            let fee_treasury_ata = &ctx.accounts.fee_treasury_ata;
            let ticket_mint_acc = &ctx.accounts.ticket_mint;

            // Mint in state must match the provided ticket_mint
            require_keys_eq!(
                ticket_mint_acc.key(),
                stored_ticket_mint,
                RaffleErrors::InvalidTicketMint
            );

            // Escrow must match what was stored in raffle
            let stored_escrow = raffle
                .ticker_escrow
                .ok_or(RaffleErrors::MissingTicketEscrow)?;
            require_keys_eq!(
                escrow.key(),
                stored_escrow,
                RaffleErrors::InvalidTicketEscrow
            );

            // Escrow mint must match ticket mint
            require_keys_eq!(
                escrow.mint,
                ticket_mint_acc.key(),
                RaffleErrors::InvalidTicketEscrowMint
            );

            // -------- Creator ATA (creator, ticket_mint) --------
            create_ata(
                &creator.to_account_info(),
                &creator_ata.to_account_info(),
                &creator.to_account_info(),
                &ticket_mint_acc.to_account_info(),
                &system_program.to_account_info(),
                &token_program.to_account_info(),
                &ctx.accounts.associated_token_program.to_account_info(),
            )?;

            // -------- Fee ATA (raffle_config, ticket_mint) --------
            // ensure ATA is for (raffle_config, ticket_mint)
            create_ata(
                &ctx.accounts.raffle_admin.to_account_info(), // payer = admin
                &fee_treasury_ata.to_account_info(),
                &raffle_config.to_account_info(), // owner = raffle_config PDA
                &ticket_mint_acc.to_account_info(),
                &system_program.to_account_info(),
                &token_program.to_account_info(),
                &ctx.accounts.associated_token_program.to_account_info(),
            )?;

            // Confirm token-account owner is raffle_config
            require_keys_eq!(
                fee_treasury_ata.owner,
                raffle_config.key(),
                RaffleErrors::InvalidFeeTreasuryAtaOwner
            );

            // --- Fee transfer: escrow -> fee_treasury_ata ---
            transfer(
                CpiContext::new_with_signer(
                    token_program.to_account_info(),
                    Transfer {
                        from: escrow.to_account_info(),
                        to: fee_treasury_ata.to_account_info(),
                        authority: raffle_ai.clone(),
                    },
                    signer_seeds,
                ),
                fee_amount,
            )
            .map_err(|_| error!(RaffleErrors::TokenTransferFailed))?;

            // --- Creator transfer: escrow -> creator_ata ---
            transfer(
                CpiContext::new_with_signer(
                    token_program.to_account_info(),
                    Transfer {
                        from: escrow.to_account_info(),
                        to: creator_ata.to_account_info(),
                        authority: raffle_ai,
                    },
                    signer_seeds,
                ),
                creator_amount,
            )
            .map_err(|_| error!(RaffleErrors::TokenTransferFailed))?;
        }
    }

    Ok(())
}

#[derive(Accounts)]
#[instruction(raffle_id: u32)]
pub struct AnnounceWinner<'info> {
    #[account(
        seeds=[b"raffle"],
        bump=raffle_config.config_bump,
        constraint = raffle_config.raffle_admin == raffle_admin.key() @ RaffleErrors::InvalidRaffleAdmin,
    )]
    pub raffle_config: Box<Account<'info, RaffleConfig>>,

    #[account(
        mut,
        seeds=[b"raffle", raffle_id.to_le_bytes().as_ref()],
        bump=raffle.raffle_bump,
        constraint = raffle.creator == raffle_creator.key() @ RaffleErrors::InvalidRaffleCreator,
        realloc = 8 + Raffle::INIT_SPACE + raffle_dynamic_space(),
        realloc::payer = raffle_admin,
        realloc::zero = true
    )]
    pub raffle: Box<Account<'info, Raffle>>,

    #[account(mut)]
    pub raffle_admin: Signer<'info>,

    #[account(mut)]
    pub raffle_creator: AccountInfo<'info>,

    // SOL treasury (PDA from config) OR SPL token ATA
    #[account(mut)]
    pub fee_treasury: AccountInfo<'info>,

    #[account(mut)]
    pub ticket_mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub ticket_escrow: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub creator_ticket_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub fee_treasury_ata: InterfaceAccount<'info, TokenAccount>,

    // SPL case accounts
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
