use crate::errors::RaffleErrors;
use crate::raffle_math::*;
use crate::states::{Buyer, PrizeType, Raffle, RaffleState};
use crate::transfer_helpers::*;
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

pub fn buy_ticket(ctx: Context<BuyTicket>, tickets_to_buy: u16) -> Result<()> {
    let raffle = &mut ctx.accounts.raffle;
    let buyer_account = &mut ctx.accounts.buyer_account;
    let buyer = &ctx.accounts.buyer;

    let now = Clock::get()?.unix_timestamp;

    // Must be within start_time .. end_time
    require_gte!(now, raffle.start_time, RaffleErrors::RaffleNotStarted);
    require_lt!(now, raffle.end_time, RaffleErrors::RaffleAlreadyEnded);
    require_gt!(tickets_to_buy, 0, RaffleErrors::InvalidZeroTickets);

    // Total supply cap: reject if not enough tickets left
    let remaining = raffle
        .total_tickets
        .checked_sub(raffle.tickets_sold)
        .ok_or(RaffleErrors::Overflow)?;
    require_gte!(remaining, tickets_to_buy, RaffleErrors::TicketsSoldOut);

    // Initialize buyer account if it's the first time.
    if buyer_account.tickets == 0 && buyer_account.user == Pubkey::default() {
        buyer_account.raffle_id = raffle.raffle_id as u64;
        buyer_account.user = buyer.key();
        buyer_account.tickets = 0;
    } else {
        require_keys_eq!(
            buyer_account.user,
            buyer.key(),
            RaffleErrors::InvalidBuyerAccountUser
        );
        require_eq!(
            buyer_account.raffle_id,
            raffle.raffle_id,
            RaffleErrors::InvalidBuyerAccountRaffle
        );
    }

    // max tickets can a single wallet can buy
    let max_tickets_can_buy: u16 =
        calculate_max_tickets(raffle.total_tickets, raffle.max_per_wallet_pct)?;

    let new_buyer_tickets = buyer_account
        .tickets
        .checked_add(tickets_to_buy)
        .ok_or(RaffleErrors::Overflow)?;

    require_gte!(
        max_tickets_can_buy,
        new_buyer_tickets,
        RaffleErrors::MaxTicketsPerWalletExceeded
    );

    // Update state(avaoid re-entrance)
    raffle.tickets_sold = raffle
        .tickets_sold
        .checked_add(tickets_to_buy)
        .ok_or(RaffleErrors::Overflow)?;
    buyer_account.tickets = new_buyer_tickets;

    // total ticket price have to pay = num of tickets * ticket_prize
    let intermediate = (raffle.ticket_price as u128)
        .checked_mul(tickets_to_buy as u128)
        .ok_or(RaffleErrors::Overflow)?;
    let price_to_pay: u64 = intermediate
        .try_into()
        .map_err(|_| RaffleErrors::Overflow)?;

    // SOL ticket (ticket_mint == None) => pay to raffle PDA lamports
    if raffle.ticket_mint.is_none() {
        transfer_sol_from_signer(
            buyer,
            &raffle.to_account_info(),
            &ctx.accounts.system_program,
            price_to_pay,
        )?;
    } else {
        // SPL ticket => transfer from buyer ATA to ticket_escrow ATA
        let ticket_mint = raffle.ticket_mint.ok_or(RaffleErrors::MissingTicketMint)?;

        // Escrow account must match what raffle stored
        let ticket_escrow = &ctx.accounts.ticket_escrow;
        let buyer_ticket_ata = &ctx.accounts.buyer_ticket_ata;

        // Ensure we are using the correct escrow ATA
        let stored_escrow = raffle
            .ticket_escrow
            .ok_or(RaffleErrors::MissingTicketEscrow)?;
        require_keys_eq!(
            ticket_escrow.key(),
            stored_escrow,
            RaffleErrors::InvalidTicketEscrow
        );

        // Basic ATA sanity: owner = buyer, mint = raffle.ticket_mint
        require_keys_eq!(
            buyer_ticket_ata.owner,
            buyer.key(),
            RaffleErrors::InvalidBuyerTicketAtaOwner
        );
        require_keys_eq!(
            buyer_ticket_ata.mint,
            ticket_mint,
            RaffleErrors::InvalidBuyerTicketAtaMint
        );

        // Transfer SPL tokens from buyer to raffle ticket escrow
        transfer_tokens(
            buyer_ticket_ata,
            ticket_escrow,
            buyer,
            &ctx.accounts.ticket_token_program,
            price_to_pay,
        )?;
    }

    // Emit event
    emit!(TicketPurchased {
        raffle_id: raffle.raffle_id,
        buyer: buyer.key(),
        tickets_bought: tickets_to_buy,
        price_paid: price_to_pay,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct BuyTicket<'info> {
    #[account(
        mut,
        seeds = [b"raffle"],
        bump = raffle_config.config_bump,
        constraint = raffle_config.raffle_admin == raffle_admin.key() @ RaffleErrors::InvalidRaffleAdmin,
    )]
    pub raffle_config: Box<Account<'info, RaffleConfig>>,

    #[account(
        mut,
        seeds = [b"raffle", raffle.raffle_id.to_le_bytes().as_ref()],
        bump = raffle.raffle_bump,
        constraint = raffle.status == RaffleState::Active @ RaffleErrors::RaffleNotActive,
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

    /// Buyer ATA for ticket mint (used only if raffle.ticket_mint.is_some())
    #[account(mut)]
    pub buyer_ticket_ata: InterfaceAccount<'info, TokenAccount>,

    /// Ticket escrow ATA owned by raffle PDA (for SPL tickets)
    #[account(mut)]
    pub ticket_escrow: InterfaceAccount<'info, TokenAccount>,

    pub ticket_token_program: Interface<'info, TokenInterface>,

    pub system_program: Program<'info, System>,
}
