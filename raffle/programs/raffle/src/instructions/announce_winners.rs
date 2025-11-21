use crate::constants::*;
use crate::errors::RaffleErrors;
use crate::states::{PrizeType, Raffle, RaffleConfig, RaffleState};
use crate::utils::has_duplicate_pubkeys;
use anchor_lang::prelude::*;

pub fn announce_winner(
    ctx: Context<AnnounceWinner>,
    raffle_id: u32,
    winners: Vec<Pubkey>,
) -> Result<()> {
    let raffle = &mut ctx.accounts.raffle;

    // ---------- Validations ----------
    require!(
        raffle.status == RaffleState::Active,
        RaffleErrors::RaffleNotActive
    );

    let now = Clock::get()?.unix_timestamp;
    require_gt!(now, raffle.end_time, RaffleErrors::RaffleNotEnded);

    let tickets_sold = raffle.tickets_sold;
    let num_winners = raffle.num_winners;

    // ---------- If zero tickets sold (FAILED) ----------
    if tickets_sold == 0 {
        raffle.status = RaffleState::FailedEnded;
        raffle.claimable_prize_back = raffle.prize_amount;

        // claimable back amount is collected by another function
        return Ok(());
    }

    // ---------------- NFT Only ----------------
    if raffle.prize_type == PrizeType::Nft {
        require!(winners.len() == 1, RaffleErrors::InvalidWinnersLength);

        raffle.winners = winners;
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
    let raffle = &mut ctx.accounts.raffle;
    let raffle_config = &ctx.accounts.raffle_config;
    let system_program = &ctx.accounts.system_program;

    let total_revenue = raffle
        .ticket_price
        .checked_mul(tickets_sold)
        .ok_or(RaffleErrors::Overflow)?;

    let fee_amount = get_pct_amount(total_revenue, raffle_config.ticket_fee_bps, FEE_MANTISSA)?;

    let creator_amount = total_revenue
        .checked_sub(fee_amount)
        .ok_or(RaffleErrors::Overflow)?;

    // PDA signer seeds
    let raffle_ai = raffle.to_account_info();
    let signer_seeds: &[&[&[u8]]] = &[&[
        b"raffle",
        &raffle.raffle_id.to_le_bytes(),
        &[raffle.raffle_bump],
    ]];

    // update the claimabel ticket amount for creator
    raffle.claimable_ticket_amount = creator_amount;

    match raffle.ticket_mint {
        // --------------------------------------------------
        // SOL: Fee is sent to config PDA
        // creator: remaining ticket mint amount(total revenue - fees) to claimable_ticket_amount(this is claimed by creator in another function)
        // --------------------------------------------------
        None => {
            transfer_sol_with_seeds(
                &raffle_ai,
                raffle_config.to_account_info(),
                system_program,
                signer_seeds,
                fee_amount,
            )?;
        }

        // --------------------------------------------------
        // SPL: fees is sent to ATA owned by raffle_config PDA
        // creator: remaining ticket mint amount(total revenue - fees) to claimable_ticket_amount(this is claimed by creator in another function)
        // --------------------------------------------------
        Some(stored_ticket_mint) => {
            let ticket_escrow = &ctx.accounts.ticket_escrow;
            let ticket_token_program = &ctx.accounts.ticket_token_program;
            let ticket_fee_treasury = &ctx.accounts.ticket_fee_treasury;
            let ticket_mint = &ctx.accounts.ticket_mint;

            // Mint in state must match the provided ticket_mint
            require_keys_eq!(
                ticket_escrow.mint,
                stored_ticket_mint,
                RaffleErrors::InvalidTicketMint
            );
            require_keys_eq!(
                ticket_mint.key(),
                stored_ticket_mint,
                RaffleErrors::InvalidTicketMint
            );

            // Escrow must match what was stored in raffle
            let stored_ticket_escrow = raffle
                .ticket_escrow
                .ok_or(RaffleErrors::MissingTicketEscrow)?;
            require_keys_eq!(
                ticket_escrow.key(),
                stored_ticket_escrow,
                RaffleErrors::InvalidTicketEscrow
            );

            // -------- Fee ATA (raffle_config, ticket_mint) --------
            // ensure ATA is for (raffle_config, ticket_mint)
            create_ata(
                &ctx.accounts.raffle_admin.to_account_info(), // payer = admin
                &ticket_fee_treasury.to_account_info(),
                &raffle_config.to_account_info(), // owner = raffle_config PDA
                &ticket_mint.to_account_info(),
                &system_program.to_account_info(),
                &ticket_token_program.to_account_info(),
                &ctx.accounts.associated_token_program.to_account_info(),
            )?;

            // Confirm token-account owner is raffle_config
            // No need to check this, because in create ata, if any values are changed then expected ata is different and return error
            // require_keys_eq!(
            //     ticket_fee_treasury.owner,
            //     raffle_config.key(),
            //     RaffleErrors::InvalidFeeTreasuryAtaOwner
            // );

            // --- Fee transfer: escrow -> ticket_fee_treasury ---
            transfer_tokens_with_seeds(
                &ticket_escrow.to_account_info(),
                &ticket_fee_treasury.to_account_info(),
                &raffle_ai.to_account_info(),
                &ticket_token_program.to_account_info(),
                signer_seeds,
                fee_amount,
            )?;
        }
    }

    Ok(())
}

#[derive(Accounts)]
#[instruction(raffle_id: u32)]
pub struct AnnounceWinner<'info> {
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
        constraint = raffle.raffle_id == raffle_id @ RaffleErrors::InvalidRaffleId,
    )]
    pub raffle: Box<Account<'info, Raffle>>,

    #[account(mut)]
    pub raffle_admin: Signer<'info>,

    pub ticket_mint: UncheckedAccount<'info>,

    // ticket escrow owner is the raffle PDA if the ticket mint == sol
    #[account(mut)]
    pub ticket_escrow: UncheckedAccount<'info>,

    // fee(spl) is stored in config ata, fee treasury owner is the config PDA if the ticket mint != sol, or else the fee(sol) is directely stored in config PDA account
    #[account(mut)]
    pub ticket_fee_treasury: UncheckedAccount<'info>,

    pub ticket_token_program: UncheckedAccount<'info>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
