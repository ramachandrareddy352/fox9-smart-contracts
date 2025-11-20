use crate::constants::*;
use crate::errors::RaffleErrors;
use crate::helpers::*;
use crate::states::{PrizeType, Raffle, RaffleConfig, RaffleState};
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
    let is_nft = prize_type == PrizeType::Nft;
    if is_nft {
        prize_amount = 1;
        num_winners = 1;
        win_shares = vec![TOTAL_PCT];
    }

    // Winners & shares validation
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
    require_gte!(
        prize_amount,
        num_winners as u64,
        RaffleErrors::InsufficientPrizeAmount
    );

    // winners validation
    require!(
        win_shares.len() == num_winners as usize,
        RaffleErrors::InvalidWinSharesLength
    );
    require!(
        validate_win_shares(&win_shares),
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
    let min_per_wallet_pct = ((TOTAL_PCT as u16 + total_tickets - 1) / total_tickets) as u8;

    require!(
        max_per_wallet_pct >= min_per_wallet_pct && max_per_wallet_pct <= config.maximum_wallet_pct,
        RaffleErrors::InvalidMaxPerWalletPct
    );

    // Set Raffle core fields
    raffle.raffle_id = config.raffle_count;
    raffle.creator = creator.key();
    raffle.start_time = start_time;
    raffle.end_time = end_time;
    raffle.total_tickets = total_tickets;
    raffle.ticket_price = ticket_price;
    raffle.max_per_wallet_pct = max_per_wallet_pct;
    raffle.prize_type = prize_type;
    raffle.prize_amount = prize_amount;
    raffle.num_winners = num_winners;
    raffle.win_shares = win_shares;
    raffle.winners = vec![Pubkey::default(); num_winners as usize];
    raffle.is_win_claimed = vec![false; num_winners as usize];
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
            raffle.prize_escrow = None;

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
            let prize_mint =
                InterfaceAccount::<Mint>::try_from(&ctx.accounts.prize_mint.to_account_info())?;
            let prize_mint_key = prize_mint.key();

            require_keys_eq!(
                prize_mint.token_program,
                ctx.accounts.prize_token_program.key(),
                RaffleErrors::InvalidTokenProgram
            );

            if is_nft {
                require_eq!(prize_mint.decimals, 0, RaffleErrors::InvalidNftDecimals);
                require_eq!(prize_mint.supply, 1, RaffleErrors::InvalidNftSupply);
            }

            // validate creator_prize_ata belongs to creator and is for prize_mint
            let creator_prize_ata = InterfaceAccount::<TokenAccount>::try_from(
                &ctx.accounts.creator_prize_ata.to_account_info(),
            )?;
            require_keys_eq!(
                creator_prize_ata.owner,
                creator.key(),
                RaffleErrors::InvalidPrizeOwner
            );
            require_keys_eq!(
                creator_prize_ata.mint,
                prize_mint_key,
                RaffleErrors::InvalidCreatorPrizeMint
            );

            raffle.prize_mint = Some(prize_mint_key);
            raffle.prize_escrow = Some(ctx.accounts.prize_escrow.key());

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

            // Deserialize prize_escrow after creation
            let prize_escrow = InterfaceAccount::<TokenAccount>::try_from(
                &ctx.accounts.prize_escrow.to_account_info(),
            )?;

            // Transfer prize tokens from creator to prize escrow
            transfer_tokens(
                &creator_prize_ata,
                &prize_escrow,
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
        raffle.ticket_escrow = None;
    } else {
        let ticket_mint =
            InterfaceAccount::<Mint>::try_from(&ctx.accounts.ticket_mint.to_account_info())?;
        let ticket_mint_key = ticket_mint.key();
        require_keys_eq!(
            ticket_mint.token_program,
            ctx.accounts.ticket_token_program.key(),
            RaffleErrors::InvalidTokenProgram
        );

        raffle.ticket_mint = Some(ticket_mint_key);
        raffle.ticket_escrow = Some(ctx.accounts.ticket_escrow.key());

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

    // Mint used for tickets (must be a valid SPL mint if `is_ticket_sol == false`)
    pub ticket_mint: UncheckedAccount<'info>,

    // Mint used for prize (must be a valid mint(SPL or NFT) if `prize_type != PrizeType::Sol`)
    pub prize_mint: UncheckedAccount<'info>,

    // Ticket escrow ATA (create ATA to store the tickets amount from the buyers and the owner of the ATA is raffle account, if ticket mint != sol)
    #[account(mut)]
    pub ticket_escrow: UncheckedAccount<'info>,

    // Prize escrow ATA (create ATA to store the prize amount and the owner of the ATA is raffle account, if prize mint != sol)
    #[account(mut)]
    pub prize_escrow: UncheckedAccount<'info>,

    // Creator's ATA for the prize mint (If prize is SOL, then no check for this ATA, otherwise validate if  if ticket mint != sol)
    #[account(mut)]
    pub creator_prize_ata: UncheckedAccount<'info>,

    /// CHECK: Validated against mint if used
    pub ticket_token_program: UncheckedAccount<'info>,
    /// CHECK: Validated against mint if used
    pub prize_token_program: UncheckedAccount<'info>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
