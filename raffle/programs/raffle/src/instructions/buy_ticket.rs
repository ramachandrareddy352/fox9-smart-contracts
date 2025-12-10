use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use crate::constants::*;
use crate::errors::*;
use crate::helpers::{transfer_sol, transfer_tokens};
use crate::states::{Buyer, Raffle, RaffleConfig, RaffleState};
use crate::utils::{calculate_max_tickets, is_paused};

#[event]
pub struct TicketPurchased {
    pub raffle_id: u32,
    pub buyer: Pubkey,
    pub tickets_bought: u16,
    pub price_paid: u64,
    pub bought_time: i64, 
}

pub fn buy_ticket(ctx: Context<BuyTicket>, raffle_id: u32, tickets_to_buy: u16) -> Result<()> {
    require!(
        !is_paused(ctx.accounts.raffle_config.pause_flags, BUY_TICKET_PAUSE),
        RaffleStateErrors::FunctionPaused
    );

    let raffle = &mut ctx.accounts.raffle;
    let buyer_account = &mut ctx.accounts.buyer_account;
    let buyer = &ctx.accounts.buyer;

    let now = Clock::get()?.unix_timestamp;

    require!(
        raffle.status == RaffleState::Active,
        RaffleStateErrors::RaffleNotActive
    );

    // Must be within start_time .. end_time
    require_gte!(
        now,
        raffle.start_time,
        RaffleStateErrors::StartTimeNotReached
    );
    require_gte!(raffle.end_time, now, RaffleStateErrors::EndTimeIsCrossed);
    require_gt!(tickets_to_buy, 0, RaffleStateErrors::InvalidZeroTickets);

    // Total supply cap: reject if not enough tickets left
    let remaining_tickets = raffle
        .total_tickets
        .checked_sub(raffle.tickets_sold)
        .ok_or(RaffleStateErrors::Overflow)?;
    require_gte!(
        remaining_tickets,
        tickets_to_buy,
        RaffleStateErrors::TicketsSoldOut
    );

    // max tickets can a single wallet can buy
    let max_tickets_can_buy: u16 =
        calculate_max_tickets(raffle.total_tickets, raffle.max_per_wallet_pct)?;

    let new_buyer_tickets = buyer_account
        .tickets
        .checked_add(tickets_to_buy)
        .ok_or(RaffleStateErrors::Overflow)?;

    require_gte!(
        max_tickets_can_buy,
        new_buyer_tickets,
        RaffleStateErrors::MaxTicketsPerWalletExceeded
    );

    // Initialize buyer account if it's the first time.
    if buyer_account.tickets == 0 && buyer_account.user == Pubkey::default() {
        buyer_account.raffle_id = raffle.raffle_id as u32;
        buyer_account.user = buyer.key();
    } else {
        require_keys_eq!(
            buyer_account.user,
            buyer.key(),
            KeysMismatchErrors::InvalidBuyerAccountUser
        );
        require_eq!(
            buyer_account.raffle_id,
            raffle_id,
            RaffleStateErrors::InvalidRaffleId
        );
    }

    // Update state(avaoid re-entrance)
    raffle.tickets_sold = raffle
        .tickets_sold
        .checked_add(tickets_to_buy)
        .ok_or(RaffleStateErrors::Overflow)?;
    buyer_account.tickets = new_buyer_tickets;

    // total ticket price have to pay = num of tickets * ticket_prize
    let price_to_pay = (raffle.ticket_price as u128)
        .checked_mul(tickets_to_buy as u128)
        .ok_or(RaffleStateErrors::Overflow)? as u64;

    // SOL ticket (ticket_mint == None) => pay to raffle PDA lamports
    if raffle.ticket_mint.is_none() {
        transfer_sol(
            buyer,
            &raffle.to_account_info(),
            &ctx.accounts.system_program,
            price_to_pay,
        )?;
    } else {
        // SPL ticket => transfer from buyer ATA to ticket_escrow ATA
        let stored_ticket_mint = raffle
            .ticket_mint
            .ok_or(KeysMismatchErrors::MissingTicketMint)?;

        // Deserialize accounts for validation and CPI
        let ticket_mint = &ctx.accounts.ticket_mint;
        let ticket_escrow = &ctx.accounts.ticket_escrow;
        let buyer_ticket_ata = &ctx.accounts.buyer_ticket_ata;

        require!(
            ticket_mint.key() == stored_ticket_mint
                && buyer_ticket_ata.mint == stored_ticket_mint
                && ticket_escrow.mint == stored_ticket_mint,
            KeysMismatchErrors::InvalidTicketMint
        );

        // Basic ATA sanity: owner = buyer, mint = raffle.ticket_mint
        require_keys_eq!(
            buyer_ticket_ata.owner,
            buyer.key(),
            KeysMismatchErrors::InvalidTicketAtaOwner
        );
        require_keys_eq!(
            ticket_escrow.owner,
            raffle.key(),
            KeysMismatchErrors::InvalidTicketEscrowOwner
        );

        // Transfer SPL tokens from buyer to raffle ticket escrow
        transfer_tokens(
            buyer_ticket_ata,
            ticket_escrow,
            buyer,
            &ctx.accounts.ticket_token_program,
            ticket_mint,
            price_to_pay,
        )?;
    }

    // Emit event
    emit!(TicketPurchased {
        raffle_id: raffle.raffle_id,
        buyer: buyer.key(),
        tickets_bought: tickets_to_buy,
        price_paid: price_to_pay,
        bought_time: now,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(raffle_id: u32)]
pub struct BuyTicket<'info> {
    #[account(
        mut,
        seeds = [b"raffle"],
        bump = raffle_config.config_bump,
        constraint = raffle_config.raffle_admin == raffle_admin.key() @ ConfigStateErrors::InvalidRaffleAdmin,
    )]
    pub raffle_config: Box<Account<'info, RaffleConfig>>,

    #[account(
        mut,
        seeds = [b"raffle", raffle_id.to_le_bytes().as_ref()],
        bump = raffle.raffle_bump,
        constraint = raffle.status == RaffleState::Active @ RaffleStateErrors::RaffleNotActive,
    )]
    pub raffle: Box<Account<'info, Raffle>>,

    #[account(
        init_if_needed,
        payer = buyer,
        space = 8 + Buyer::INIT_SPACE,
        seeds = [
            b"raffle",
            raffle_id.to_le_bytes().as_ref(),
            buyer.key().as_ref(),
        ],
        bump
    )]
    pub buyer_account: Box<Account<'info, Buyer>>,

    #[account(mut)]
    pub buyer: Signer<'info>,

    pub raffle_admin: Signer<'info>,

    // buyer pays the amount with this mint and this mint hsould be match with raffle stored ticket_mint key
    pub ticket_mint: InterfaceAccount<'info, Mint>,

    // Buyer ATA for ticket mint (used only if raffle.ticket_mint.is_some())
    #[account(mut)]
    pub buyer_ticket_ata: InterfaceAccount<'info, TokenAccount>,

    // Ticket escrow ATA owned by raffle PDA (for SPL tickets)
    #[account(mut)]
    pub ticket_escrow: InterfaceAccount<'info, TokenAccount>,

    pub ticket_token_program: Interface<'info, TokenInterface>,

    pub system_program: Program<'info, System>,
}
