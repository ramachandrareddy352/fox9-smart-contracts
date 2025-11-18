use crate::constants::{MAX_PER_WALLET_PCT, TOTAL_PCT};
use crate::errors::RaffleErrors;
use crate::raffle_math::{calculate_max_tickets, is_descending_order_and_sum_100};
use crate::states::{PrizeType, Raffle, RaffleConfig, RaffleState};
use crate::transfer_helpers::create_ata;
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

pub fn update_raffle_ticketing(
    ctx: Context<UpdateRaffleTicketing>,
    raffle_id: u32,
    new_total_tickets: u16,
    new_ticket_price: u64,
    new_max_per_wallet_pct: u8,
    is_ticket_sol: bool,
) -> Result<()> {
    let config = &ctx.accounts.raffle_config;
    let raffle = &mut ctx.accounts.raffle;
    let creator = &ctx.accounts.creator;

    // Identity and access control
    require_eq!(raffle.raffle_id, raffle_id, RaffleErrors::InvalidRaffleId);
    require_keys_eq!(raffle.creator, creator.key(), RaffleErrors::InvalidCreator);

    // Only Initialized or Active raffles can be updated
    require!(
        matches!(
            raffle.status,
            RaffleState::Initialized | RaffleState::Active
        ),
        RaffleErrors::InvalidRaffleStateForUpdate
    );

    // No tickets sold yet
    require_eq!(raffle.tickets_sold, 0, RaffleErrors::TicketsAlreadySold);

    // Basic ticketing validations
    require_gt!(new_ticket_price, 0, RaffleErrors::InvalidTicketZeroPrice);
    require!(
        config.minimum_tickets <= new_total_tickets && new_total_tickets <= config.maximum_tickets,
        RaffleErrors::InvalidTotalTickets
    );
    require_gte!(
        new_total_tickets,
        raffle.num_winners as u16,
        RaffleErrors::WinnersExceedTotalTickets
    );

    // Ensure at least 1 ticket possible under max_per_wallet_pct
    let min_per_wallet_pct =
        ((100u16 + new_total_tickets as u16 - 1) / new_total_tickets as u16) as u8;
    require!(
        new_max_per_wallet_pct >= min_per_wallet_pct
            && new_max_per_wallet_pct <= MAX_PER_WALLET_PCT,
        RaffleErrors::InvalidMaxPerWalletPct
    );

    // Handle ticket mint transition (SOL ↔ SPL)
    let current_ticket_mint = raffle.ticket_mint;
    let ticket_escrow_ai = ctx.accounts.ticket_escrow.to_account_info();
    let raffle_ai = raffle.to_account_info();
    let system_program_ai = ctx.accounts.system_program.to_account_info();

    // Ticket mint transition logic
    // PDA signer seeds for escrow authority
    let seeds: &[&[u8]] = &[
        b"raffle",
        &raffle.raffle_id.to_le_bytes(),
        &[raffle.raffle_bump],
    ];
    let signer_seeds: &[&[&[u8]]] = &[seeds];

    let new_mint_key = if is_ticket_sol {
        None
    } else {
        Some(ctx.accounts.ticket_mint.key())
    };

    match (current_ticket_mint, new_mint_key) {
        // Case 1: SOL -> SOL
        (None, None) => {
            // No work needed
        }

        // Case 2: SPL -> SOL  (close old escrow)
        (Some(old_mint), None) => {
            let ticket_escrow = &ctx.accounts.ticket_escrow;

            // Require correct escrow mint (optional — basic checks were requested)
            require_keys_eq!(
                ticket_escrow.mint,
                old_mint,
                RaffleErrors::InvalidTicketMintChange
            );

            // Optional check: require amount == 0?
            // If required uncomment below, otherwise skip
            // require_eq!(ticket_escrow.amount, 0, RaffleErrors::TicketEscrowNotEmpty);

            // Close the account & return rent to creator
            close_token_account_with_seeds(
                ticket_escrow,
                &creator.to_account_info(),
                &raffle_ai,
                &ctx.accounts.ticket_token_program,
                signer_seeds,
            )?;

            raffle.ticket_mint = None;
            raffle.ticker_escrow = None;
        }

        // Case 3: SOL -> SPL (create new escrow ATA)
        (None, Some(new_mint)) => {
            create_ata(
                &creator.to_account_info(),
                &ticket_escrow_ai,
                &raffle_ai,
                &ctx.accounts.ticket_mint.to_account_info(),
                &system_program_ai,
                &ctx.accounts.ticket_token_program.to_account_info(),
                &ctx.accounts.associated_token_program.to_account_info(),
            )?;

            raffle.ticket_mint = Some(new_mint);
            raffle.ticker_escrow = Some(ctx.accounts.ticket_escrow.key());
        }

        // Case 4: SPL -> SPL (close old escrow, create new one)
        (Some(old_mint), Some(new_mint)) => {
            // if the old and new spl are same then skip this logic
            if (old_mint != new_mint) {
                let ticket_escrow = &ctx.accounts.ticket_escrow;

                // Close the old escrow (no amount check required per request)
                close_token_account_with_seeds(
                    ticket_escrow,
                    &creator.to_account_info(),
                    &raffle_ai,
                    &ctx.accounts.ticket_token_program,
                    signer_seeds,
                )?;

                // Create new escrow ATA for new mint
                create_ata(
                    &creator.to_account_info(),
                    &ticket_escrow_ai,
                    &raffle_ai,
                    &ctx.accounts.ticket_mint.to_account_info(),
                    &system_program_ai,
                    &ctx.accounts.ticket_token_program.to_account_info(),
                    &ctx.accounts.associated_token_program.to_account_info(),
                )?;

                raffle.ticket_mint = Some(new_mint);
                raffle.ticker_escrow = Some(ctx.accounts.ticket_escrow.key());
            }
        }
    }

    // Apply updates
    raffle.total_tickets = new_total_tickets;
    raffle.ticket_price = new_ticket_price;
    raffle.max_per_wallet_pct = new_max_per_wallet_pct;

    Ok(())
}

#[derive(Accounts)]
#[instruction(raffle_id: u32)]
pub struct UpdateRaffleTicketing<'info> {
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
        constraint = raffle.creator == creator.key() @ RaffleErrors::InvalidCreator,
    )]
    pub creator: Signer<'info>,

    #[account(mut)]
    pub raffle_admin: Signer<'info>,

    /// New or existing ticket mint (used when is_ticket_sol == false)
    pub ticket_mint: InterfaceAccount<'info, Mint>,

    /// Ticket escrow ATA owned by raffle PDA (for SPL tickets)
    #[account(mut)]
    pub ticket_escrow: InterfaceAccount<'info, TokenAccount>,

    pub ticket_token_program: Interface<'info, TokenInterface>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
