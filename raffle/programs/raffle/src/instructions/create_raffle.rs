use crate::constants::*;
use crate::errors::{ConfigStateErrors, KeysMismatchErrors, RaffleStateErrors};
use crate::helpers::*;
use crate::states::*;
use crate::utils::{is_paused, validate_win_shares};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

#[event]
pub struct RaffleCreated {
    pub raffle_id: u32,
    pub creator: Pubkey,
    pub start_time: i64,
    pub end_time: i64,
    pub created_at: i64,
}
 
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

    require!(
        !is_paused(config.pause_flags, CREATE_RAFFLE_PAUSE),
        RaffleStateErrors::FunctionPaused
    ); 

    let raffle = &mut ctx.accounts.raffle;
    let creator = &ctx.accounts.creator;
    let now = Clock::get()?.unix_timestamp;

    // --- Basic validations ---
    require_gt!(ticket_price, 0, RaffleStateErrors::InvalidTicketZeroPrice);
    require!(
        MINIMUM_TICKETS <= total_tickets && total_tickets <= MAXIMUM_TICKETS,
        RaffleStateErrors::InvalidTotalTickets
    );

    // --- Apply NFT defaults ---
    let is_nft = prize_type == PrizeType::Nft;
    if is_nft {
        prize_amount = 1;
        num_winners = 1;
        win_shares = vec![TOTAL_PCT];
    }

    // --- Winners & shares validation ---
    require_gt!(num_winners, 0, RaffleStateErrors::InvalidZeroWinnersCount);
    require_gte!(
        total_tickets,
        num_winners as u16,
        RaffleStateErrors::WinnersExceedTotalTickets
    );
    require_gte!(
        MAXIMUM_WINNERS_COUNT,
        num_winners,
        RaffleStateErrors::ExceedMaxWinners
    );
    require_gte!(
        prize_amount,
        num_winners as u64,
        RaffleStateErrors::InsufficientPrizeAmount
    );

    require_eq!(
        win_shares.len() as u8,
        num_winners,
        RaffleStateErrors::InvalidWinShares
    );
    require!(
        validate_win_shares(&win_shares),
        RaffleStateErrors::InvalidWinShares
    );

    // --- Time validation ---
    if start_raffle {
        start_time = now;
    }
    let duration = end_time
        .checked_sub(start_time)
        .ok_or(RaffleStateErrors::StartTimeExceedEndTime)?;

    require_gte!(start_time, now, RaffleStateErrors::StartTimeInPast);
    require!(
        duration >= config.minimum_raffle_period as i64
            && duration <= config.maximum_raffle_period as i64,
        ConfigStateErrors::InvalidRafflePeriod
    );

    // --- Max per wallet validation ---
    let min_pct = ((TOTAL_PCT as u16 + total_tickets - 1) / total_tickets) as u8;
    require!(
        max_per_wallet_pct >= min_pct && max_per_wallet_pct <= MAXIMUM_WALLET_PCT,
        RaffleStateErrors::InvalidMaxPerWalletPct
    );

    // --- Set raffle metadata ---
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
    raffle.is_unique_winners = is_unique_winners;
    raffle.status = if start_raffle {
        RaffleState::Active
    } else {
        RaffleState::Initialized
    };
    raffle.raffle_bump = ctx.bumps.raffle;

    // Pay creation fee separately
    if config.creation_fee_lamports > 0 {
        transfer_sol(
            creator,
            &config.to_account_info(),
            &ctx.accounts.system_program,
            config.creation_fee_lamports,
        )?;
    }

    // --- Prize Handling ---
    match prize_type {
        PrizeType::Sol => {
            raffle.prize_mint = None;

            transfer_sol(
                creator,
                &raffle.to_account_info(),
                &ctx.accounts.system_program,
                prize_amount,
            )?;
        }

        PrizeType::Nft | PrizeType::Spl => {
            let prize_mint = &ctx.accounts.prize_mint;
            let prize_mint_key = prize_mint.key();

            let prize_nft = prize_mint.decimals == 0 && prize_mint.supply == 1;

            require!(prize_nft == is_nft, RaffleStateErrors::InvalidNFT);

            // Validate creator's prize ATA
            let creator_ata = &ctx.accounts.creator_prize_ata;
            require_keys_eq!(
                creator_ata.owner,
                creator.key(),
                KeysMismatchErrors::InvalidPrizeAtaOwner
            );
            require_keys_eq!(
                creator_ata.mint,
                prize_mint_key,
                KeysMismatchErrors::InvalidPrizeMint
            );

            let prize_escrow = &ctx.accounts.prize_escrow;
            require_keys_eq!(
                prize_escrow.owner,
                raffle.key(),
                KeysMismatchErrors::InvalidPrizeEscrowOwner
            );
            require_keys_eq!(
                prize_escrow.mint,
                prize_mint_key,
                KeysMismatchErrors::InvalidPrizeMint
            );

            // Transfer prize tokens
            transfer_tokens(
                creator_ata,
                prize_escrow,
                creator,
                &ctx.accounts.prize_token_program,
                prize_mint,
                prize_amount,
            )?;

            raffle.prize_mint = Some(prize_mint_key);
        }
    }

    // --- Ticket Escrow (only if SPL tickets) ---
    if is_ticket_sol {
        raffle.ticket_mint = None;
    } else {
        let ticket_mint = &ctx.accounts.ticket_mint;
        let ticket_mint_key = ticket_mint.key();

        let ticket_escrow = &ctx.accounts.ticket_escrow;
        require_keys_eq!(
            ticket_escrow.owner,
            raffle.key(),
            KeysMismatchErrors::InvalidTicketEscrowOwner
        );
        require_keys_eq!(
            ticket_escrow.mint,
            ticket_mint_key,
            KeysMismatchErrors::InvalidTicketMint
        );

        raffle.ticket_mint = Some(ticket_mint_key);
    }

    // --- Increment global raffle counter ---
    config.raffle_count = config
        .raffle_count
        .checked_add(1)
        .ok_or(RaffleStateErrors::Overflow)?;

    emit!(RaffleCreated {
        raffle_id: raffle.raffle_id,
        creator: creator.key(),
        start_time: raffle.start_time,
        end_time: raffle.end_time,
        created_at: now,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct CreateRaffle<'info> {
    #[account(
        mut,
        seeds = [b"raffle"],
        bump = raffle_config.config_bump,
        constraint = raffle_admin.key() == raffle_config.raffle_admin @ ConfigStateErrors::InvalidRaffleAdmin,
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
    pub ticket_mint: InterfaceAccount<'info, Mint>,

    // Mint used for prize (must be a valid mint(SPL or NFT) if `prize_type != PrizeType::Sol`)
    pub prize_mint: InterfaceAccount<'info, Mint>,

    // Ticket escrow ATA (create ATA to store the tickets amount from the buyers and the owner of the ATA is raffle account, if ticket mint != sol)
    #[account(mut)]
    pub ticket_escrow: InterfaceAccount<'info, TokenAccount>,

    // Prize escrow ATA (create ATA to store the prize amount and the owner of the ATA is raffle account, if prize mint != sol)
    #[account(mut)]
    pub prize_escrow: InterfaceAccount<'info, TokenAccount>,

    // Creator's ATA for the prize mint (If prize is SOL, then no check for this ATA, otherwise validate if  if ticket mint != sol)
    #[account(mut)]
    pub creator_prize_ata: InterfaceAccount<'info, TokenAccount>,

    pub ticket_token_program: Interface<'info, TokenInterface>,
    pub prize_token_program: Interface<'info, TokenInterface>,

    pub system_program: Program<'info, System>,
}
