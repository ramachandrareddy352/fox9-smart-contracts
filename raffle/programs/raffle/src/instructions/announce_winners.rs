use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use crate::constants::*;
use crate::errors::{ConfigStateErrors, KeysMismatchErrors, RaffleStateErrors};
use crate::helpers::{transfer_sol_with_seeds, transfer_tokens_with_seeds};
use crate::states::*;
use crate::utils::{get_pct_amount, has_duplicate_pubkeys, is_paused};

#[event]
pub struct ColledtedTicketRevenue {
    pub raffle_id: u32,
    pub creator_amount: u64,
    pub fee_amount: u64,
    pub total_tickets_sold: u16,
}

#[event]
pub struct WinnersAnnounced {
    pub raffle_id: u32,
    pub effective_winners: u8,
    pub claimable_prize_back: u64,
    pub announce_time: i64,
}

#[event]
pub struct RaffleFailed {
    pub raffle_id: u32,
    pub claimable_prize_back: u64,
    pub announce_time: i64,
}

pub fn announce_winners(
    mut ctx: Context<AnnounceWinners>,
    raffle_id: u32,
    winners: Vec<Pubkey>,
) -> Result<()> {
    let raffle = &mut ctx.accounts.raffle;

    require!(
        !is_paused(
            ctx.accounts.raffle_config.pause_flags,
            ANNOUNCE_WINNER_PAUSE
        ),
        RaffleStateErrors::FunctionPaused
    );

    // ---------- Validations ----------
    require!(
        raffle.status == RaffleState::Active,
        RaffleStateErrors::RaffleNotActive
    );

    let now = Clock::get()?.unix_timestamp;
    require_gt!(now, raffle.end_time, RaffleStateErrors::EndTimeNotReached);

    let tickets_sold = raffle.tickets_sold;
    let num_winners = raffle.num_winners as usize;
    let prize_amount = raffle.prize_amount;

    // ---------- If zero tickets sold (FAILED) ----------
    if tickets_sold == 0 {
        emit!(RaffleFailed {
            raffle_id,
            claimable_prize_back: prize_amount,
            announce_time: now,
        });
        raffle.status = RaffleState::FailedEnded;
        raffle.claimable_prize_back = prize_amount;
        return Ok(());
    }

    // ---------------- NFT Only ----------------
    if raffle.prize_type == PrizeType::Nft {
        require!(winners.len() == 1, RaffleStateErrors::InvalidWinnersLength);
        raffle.winners = winners;
        raffle.status = RaffleState::SuccessEnded;

        process_ticket_revenue(&mut ctx, tickets_sold)?; // ← now &mut

        emit!(WinnersAnnounced {
            raffle_id,
            effective_winners: 1,
            claimable_prize_back: 0,
            announce_time: now,
        });
        return Ok(());
    }

    // ---------------- SPL or SOL Prize Path ----------------
    let sold_usize = tickets_sold as usize;
    let actual_winners = sold_usize.min(num_winners);

    require!(
        winners.len() == actual_winners,
        RaffleStateErrors::InvalidWinnersLength
    );

    if raffle.is_unique_winners {
        require!(
            !has_duplicate_pubkeys(&winners),
            RaffleStateErrors::DuplicateWinnersNotAllowed
        );
    }

    let mut claimable_back: u64 = 0;
    let total_pct = TOTAL_PCT;

    if sold_usize < num_winners {
        let assigned_pct: u8 = raffle.win_shares.iter().take(actual_winners).copied().sum();

        require!(
            assigned_pct <= total_pct,
            RaffleStateErrors::InvalidWinShares
        );

        let leftover_pct = total_pct
            .checked_sub(assigned_pct)
            .ok_or(RaffleStateErrors::Overflow)?;

        if leftover_pct > 0 {
            claimable_back = get_pct_amount(prize_amount, leftover_pct as u64, total_pct as u64)?;
        }
    }

    emit!(WinnersAnnounced {
        raffle_id,
        effective_winners: actual_winners as u8,
        claimable_prize_back: claimable_back,
        announce_time: now,
    });

    raffle.claimable_prize_back = claimable_back;
    raffle.winners = winners;
    raffle.status = RaffleState::SuccessEnded;

    // Process revenue transfers (fees + creator share)
    process_ticket_revenue(&mut ctx, tickets_sold)?; // ← &mut Context

    Ok(())
}

// Fixed signature + fixed temporary borrow in seeds
fn process_ticket_revenue(ctx: &mut Context<AnnounceWinners>, tickets_sold: u16) -> Result<()> {
    let raffle = &mut ctx.accounts.raffle;
    let raffle_config = &ctx.accounts.raffle_config;
    let system_program = &ctx.accounts.system_program;

    let total_revenue = raffle
        .ticket_price
        .checked_mul(tickets_sold as u64)
        .ok_or(RaffleStateErrors::Overflow)?;

    let fee_amount = get_pct_amount(
        total_revenue,
        raffle_config.ticket_fee_bps as u64,
        FEE_MANTISSA as u64,
    )?;

    let creator_amount = total_revenue
        .checked_sub(fee_amount)
        .ok_or(RaffleStateErrors::Overflow)?;

    // Fix temporary borrow: store the bytes in a variable with longer lifetime
    let raffle_id_bytes = raffle.raffle_id.to_le_bytes();

    let signer_seeds: &[&[u8]] = &[b"raffle", &raffle_id_bytes, &[raffle.raffle_bump]];
    let seeds: &[&[&[u8]]] = &[signer_seeds];

    let raffle_ai = raffle.to_account_info();

    // Update claimable amount for creator
    raffle.claimable_ticket_amount = creator_amount;

    match raffle.ticket_mint {
        None => {
            // SOL: transfer fee to config PDA
            transfer_sol_with_seeds(
                &raffle_ai,
                &raffle_config.to_account_info(),
                system_program,
                seeds,
                fee_amount,
            )?;
        }
        Some(stored_mint) => {
            let escrow = &ctx.accounts.ticket_escrow;
            let treasury = &ctx.accounts.ticket_fee_treasury;
            let mint = &ctx.accounts.ticket_mint;

            require_keys_eq!(
                escrow.mint,
                stored_mint,
                KeysMismatchErrors::InvalidTicketMint
            );
            require_keys_eq!(
                mint.key(),
                stored_mint,
                KeysMismatchErrors::InvalidTicketMint
            );

            let stored_escrow = raffle
                .ticket_escrow
                .ok_or(KeysMismatchErrors::MissingTicketEscrow)?;
            require_keys_eq!(
                escrow.key(),
                stored_escrow,
                KeysMismatchErrors::InvalidTicketEscrow
            );

            require_keys_eq!(
                treasury.owner,
                raffle_config.key(),
                KeysMismatchErrors::InvalidFeeTreasuryAtaOwner
            );
            require_keys_eq!(
                treasury.mint,
                stored_mint,
                KeysMismatchErrors::InvalidTicketMint
            );

            transfer_tokens_with_seeds(
                escrow,
                treasury,
                &raffle_ai,
                &ctx.accounts.ticket_token_program,
                mint,
                seeds,
                fee_amount,
            )?;
        }
    }

    emit!(ColledtedTicketRevenue {
        raffle_id: raffle.raffle_id,
        creator_amount,
        fee_amount,
        total_tickets_sold: tickets_sold,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(raffle_id: u32)]
pub struct AnnounceWinners<'info> {
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

    #[account(mut)]
    pub raffle_admin: Signer<'info>,

    pub ticket_mint: InterfaceAccount<'info, Mint>,

    // ticket escrow owner is the raffle PDA if the ticket mint == sol
    #[account(mut)]
    pub ticket_escrow: InterfaceAccount<'info, TokenAccount>,

    // fee(spl) is stored in config ata, fee treasury owner is the config PDA if the ticket mint != sol, or else the fee(sol) is directely stored in config PDA account
    #[account(mut)]
    pub ticket_fee_treasury: InterfaceAccount<'info, TokenAccount>,

    pub ticket_token_program: Interface<'info, TokenInterface>,

    pub system_program: Program<'info, System>,
}
