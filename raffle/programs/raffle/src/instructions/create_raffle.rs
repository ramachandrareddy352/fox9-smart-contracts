use crate::errors::RaffleErrors;
use crate::states::{PrizeType, Raffle, RaffleConfig, RaffleState};
use crate::transfer_helpers::*;
use crate::utils::*;
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

pub fn create_raffle(
    ctx: Context<CreateRaffle>,
    mut start_time: i64,
    end_time: i64,
    total_tickets: u16,
    ticket_price: u64,
    is_ticket_sol: bool,
    max_per_wallet_pct: u8,
    prize_type: PrizeType,
    mut prize_amount: u64,
    mut num_winners: u8,
    mut win_shares: Vec<u8>,
    is_unique_winners: bool,
    start_raffle: bool,
) -> Result<()> {
    let config = &mut ctx.accounts.raffle_config;
    let raffle = &mut ctx.accounts.raffle;
    let creator = &ctx.accounts.creator;

    // Basic validations
    require_gt!(ticket_price, 0, RaffleErrors::InvalidTicketZeroPrice);
    require!(
        config.minimum_tickets <= total_tickets && total_tickets <= config.maximum_tickets,
        RaffleErrors::InvalidTotalTickets
    );

    // Apply NFT defaults early to simplify later checks
    if prize_type == PrizeType::Nft {
        prize_amount = 1;
        num_winners = 1;
        win_shares = vec![TOTAL_PCT];
    }

    // Winners & shares validation (NFT and non-NFT)
    require_gt!(num_winners, 0, RaffleErrors::InvalidZeroWinnersCount);
    require_gte!(
        total_tickets,
        num_winners as u16,
        RaffleErrors::WinnersExceedTotalTickets
    );
    require_gte!(
        config.maximum_winners_count,
        num_winners,
        RaffleErrors::ExceedMaxWinners
    );
    require_gt!(prize_amount, 0, RaffleErrors::InvalidZeroPrizeAmount);

    // prize_amount must be at least num_winners
    require_gte!(
        prize_amount,
        num_winners as u64,
        RaffleErrors::InsufficientPrizeAmount
    );

    require!(
        win_shares.len() == num_winners as usize,
        RaffleErrors::InvalidWinSharesLength
    );

    // no zero shares allowed (every winner must get > 0%)
    require!(
        win_shares.iter().all(|&s| s > 0),
        RaffleErrors::InvalidZeroShareWinner
    );

    require!(
        is_descending_order_and_sum_100(&win_shares),
        RaffleErrors::InvalidWinShares
    );

    // Time validation
    let current_time = Clock::get()?.unix_timestamp;
    if start_raffle {
        start_time = current_time;
    }
    let duration = end_time
        .checked_sub(start_time)
        .ok_or(RaffleErrors::StartTimeExceedEndTime)?;

    require_gte!(start_time, current_time, RaffleErrors::StartTimeInPast);
    require!(
        duration >= config.minimum_raffle_period as i64
            && duration <= config.maximum_raffle_period as i64,
        RaffleErrors::InvalidRafflePeriod
    );

    // Max per wallet validation (ensure at least 1 ticket possible), ceil(100 / total_tickets)
    let min_per_wallet_pct = ((100u16 + total_tickets as u16 - 1) / total_tickets as u16) as u8;

    require!(
        max_per_wallet_pct >= min_per_wallet_pct && max_per_wallet_pct <= MAX_PER_WALLET_PCT,
        RaffleErrors::InvalidMaxPerWalletPct
    );

    // Set Raffle core fields
    raffle.raffle_id = config.raffle_count;
    raffle.creator = creator.key();
    raffle.start_time = start_time;
    raffle.end_time = end_time;
    raffle.total_tickets = total_tickets;
    raffle.tickets_sold = 0;
    raffle.ticket_price = ticket_price;
    raffle.max_per_wallet_pct = max_per_wallet_pct;
    raffle.prize_type = prize_type;
    raffle.prize_amount = prize_amount;
    raffle.num_winners = num_winners;
    raffle.win_shares = win_shares;
    raffle.status = if start_raffle {
        RaffleState::Active
    } else {
        RaffleState::Initialized
    };
    raffle.is_unique_winners = is_unique_winners;
    raffle.claimable_prize_back = 0;
    raffle.raffle_bump = ctx.bumps.raffle;

    // Prize Handling
    match prize_type {
        PrizeType::Sol => {
            // Prize is paid in SOL into raffle PDA
            raffle.prize_mint = None;
            raffle.price_escrow = None;

            // transfer prize amount + creation fee to raffle PDA
            transfer_sol_from_signer(
                creator,
                &raffle.to_account_info(),
                &ctx.accounts.system_program,
                prize_amount
                    .checked_add(config.creation_fee_lamports)
                    .ok_or(RaffleErrors::Overflow)?,
            )?;
        }
        _ => {
            let prize_mint_key = ctx.accounts.prize_mint.key();

            // validate creator_prize_ata belongs to creator and is for prize_mint
            let creator_prize_ata = &ctx.accounts.creator_prize_ata;
            require_keys_eq!(
                creator_prize_ata.owner,
                creator.key(),
                RaffleErrors::InvalidCreatorPrizeAtaOwner
            );
            require_keys_eq!(
                creator_prize_ata.mint,
                prize_mint_key,
                RaffleErrors::InvalidCreatorPrizeAtaMint
            );

            raffle.prize_mint = Some(prize_mint_key);
            raffle.price_escrow = Some(ctx.accounts.prize_escrow.key());

            // Ensure prize escrow is the correct ATA for (raffle, prize_mint)
            create_ata(
                &creator.to_account_info(),
                &ctx.accounts.prize_escrow.to_account_info(),
                &raffle.to_account_info(),
                &ctx.accounts.prize_mint.to_account_info(),
                &ctx.accounts.system_program.to_account_info(),
                &ctx.accounts.prize_token_program.to_account_info(),
                &ctx.accounts.associated_token_program.to_account_info(),
            )?;

            // Transfer prize tokens from creator to prize escrow
            transfer_tokens(
                &ctx.accounts.creator_prize_ata,
                &ctx.accounts.prize_escrow,
                &creator,
                &ctx.accounts.prize_token_program,
                prize_amount,
            )?;

            // Pay creation fee in SOL
            transfer_sol_from_signer(
                creator,
                &raffle.to_account_info(),
                &ctx.accounts.system_program,
                config.creation_fee_lamports,
            )?;
        }
    }

    // Ticket Escrow Handling
    if is_ticket_sol {
        // Ticket purchase in SOL: no token mint / escrow
        raffle.ticket_mint = None;
        raffle.ticker_escrow = None;
    } else {
        let ticket_mint_key = ctx.accounts.ticket_mint.key();
        raffle.ticket_mint = Some(ticket_mint_key);
        raffle.ticker_escrow = Some(ctx.accounts.ticket_escrow.key());

        // Ensure ticket escrow is the correct ATA for (raffle, ticket_mint)
        create_ata(
            &creator.to_account_info(),
            &ctx.accounts.ticket_escrow.to_account_info(),
            &raffle.to_account_info(),
            &ctx.accounts.ticket_mint.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
            &ctx.accounts.ticket_token_program.to_account_info(),
            &ctx.accounts.associated_token_program.to_account_info(),
        )?;
    }

    // Increment raffle count
    config.raffle_count = config
        .raffle_count
        .checked_add(1)
        .ok_or(RaffleErrors::Overflow)?;

    Ok(())
}

#[derive(Accounts)]
pub struct CreateRaffle<'info> {
    #[account(
        mut,
        seeds = [b"raffle"],
        bump = raffle_config.config_bump,
        constraint = raffle_admin.key() == raffle_config.raffle_admin @ RaffleErrors::InvalidRaffleAdmin,
    )]
    pub raffle_config: Box<Account<'info, RaffleConfig>>,

    #[account(
        init,
        payer = creator,
        space = 8 + Raffle::INIT_SPACE,
        seeds = [b"raffle", raffle_config.raffle_count.to_le_bytes().as_ref()],
        bump
    )]
    pub raffle: Box<Account<'info, Raffle>>,

    #[account(mut)]
    pub creator: Signer<'info>,

    pub raffle_admin: Signer<'info>,

    /// Mint used for tickets (must be a valid SPL mint if `is_ticket_sol == false`)
    pub ticket_mint: InterfaceAccount<'info, Mint>,

    /// Mint used for prize (must be a valid SPL mint if `prize_type != PrizeType::Sol`)
    pub prize_mint: InterfaceAccount<'info, Mint>,

    /// Ticket escrow ATA (create ATA to store the tickets amount from the buyers and the owner of the ATA is raffle account)
    #[account(mut)]
    pub ticket_escrow: InterfaceAccount<'info, TokenAccount>,

    /// Prize escrow ATA (create ATA to store the prize amount and the owner of the ATA is raffle account)
    #[account(mut)]
    pub prize_escrow: InterfaceAccount<'info, TokenAccount>,

    /// Creator's ATA for the prize mint (If prize is SOL, then no check for this ATA)
    #[account(mut)]
    pub creator_prize_ata: InterfaceAccount<'info, TokenAccount>,

    pub ticket_token_program: Interface<'info, TokenInterface>,
    pub prize_token_program: Interface<'info, TokenInterface>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
