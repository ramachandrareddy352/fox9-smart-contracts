use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use crate::constants::*;
use crate::errors::{ConfigStateErrors, GumballStateErrors};
use crate::helpers::*;
use crate::states::*;
use crate::utils::*;

#[event]
pub struct PrizeAdded {
    pub gumball_id: u32,
    pub prize_index: u16,
    pub prize_mint: Pubkey,
    pub prize_amount: u64,
    pub quantitiy: u16,
    pub added_at: i64,
}

pub fn add_prize(
    ctx: Context<AddPrize>,
    gumball_id: u32,
    prize_index: u16,
    prize_amount: u64,
    quantity: u16,
) -> Result<()> {
    let gumball = &mut ctx.accounts.gumball;
    let prize_acc = &mut ctx.accounts.prize;

    let creator = &ctx.accounts.creator;
    let prize_mint = &ctx.accounts.prize_mint;

    let now = Clock::get()?.unix_timestamp;

    // Pause check (uses your is_paused util and ADD_PRIZE_IN_GUMBALL_PAUSE constant)
    require!(
        !is_paused(
            ctx.accounts.gumball_config.pause_flags,
            ADD_PRIZE_IN_GUMBALL_PAUSE
        ),
        GumballStateErrors::FunctionPaused
    );

    // Only allow in Initialized or Active states
    require!(
        gumball.status == GumballState::Initialized || gumball.status == GumballState::Active,
        GumballStateErrors::InvalidGumballState
    );

    require_gte!(gumball.end_time, now, GumballStateErrors::EndTimeIsReached);

    // Validate mint if NFT
    let is_nft = validate_nft(prize_mint);
    if is_nft {
        // For NFTs: prize_amount must equal 1 and quantity must be 1 (single NFT prize)
        require_eq!(
            prize_amount,
            1u64,
            GumballStateErrors::InvalidNftPrizeAmount
        );
        require_eq!(quantity, 1u16, GumballStateErrors::InvalidNftPrizeQuantity);
    } else {
        // For SPL: prize_amount must be > 0 and quantity > 0
        require_gt!(prize_amount, 0, GumballStateErrors::InvalidPrizeAmount);
        require_gt!(quantity, 0, GumballStateErrors::InvalidPrizeQuantity);
    }

    // Ensure prizes don't exceed total tickets
    let new_total_prizes = gumball
        .prizes_added
        .checked_add(quantity)
        .ok_or(GumballStateErrors::Overflow)?;
    require_gte!(
        gumball.total_tickets,
        new_total_prizes,
        GumballStateErrors::PrizesExceedTickets
    );

    // Determine whether prize PDA already initialized.
    // Anchor-created account with init_if_needed will return an account whose fields are default (zero)
    // if just created; so detect existing by checking mint != Pubkey::default()
    let prize_exists = prize_acc.mint != Pubkey::default();
    // For SPL: update totals and transfer additional tokens (prize_amount * quantity)
    let add_amount = (prize_amount as u128)
        .checked_mul(quantity as u128)
        .ok_or(GumballStateErrors::Overflow)? as u64;

    if prize_exists {
        // If prize already exists: ensure mint and prize_amount match
        require_eq!(
            prize_acc.gumball_id,
            gumball_id,
            GumballStateErrors::InvalidGumballId
        );
        require_eq!(
            prize_acc.prize_index,
            prize_index,
            GumballStateErrors::InvalidPrizeIndex
        );
        require_keys_eq!(
            prize_acc.mint,
            prize_mint.key(),
            GumballStateErrors::PrizeMintMismatch
        );
        require_eq!(
            prize_acc.prize_amount,
            prize_amount,
            GumballStateErrors::PrizeAmountMismatch
        );

        // If existing prize is NFT -> you must not add more because PDA would be same
        if prize_acc.if_prize_nft || is_nft {
            return err!(GumballStateErrors::CannotAddExistingNftPrize);
        }

        // Update on-chain prize struct fields
        prize_acc.total_amount = prize_acc
            .total_amount
            .checked_add(add_amount)
            .ok_or(GumballStateErrors::Overflow)?;
        prize_acc.quantity = prize_acc
            .quantity
            .checked_add(quantity)
            .ok_or(GumballStateErrors::Overflow)?;
    } else {
        // New prize: initialize fields and transfer total tokens to escrow
        prize_acc.gumball_id = gumball_id;
        prize_acc.prize_index = prize_index;
        prize_acc.if_prize_nft = is_nft;
        prize_acc.mint = prize_mint.key();
        prize_acc.prize_amount = prize_amount;
        prize_acc.quantity = quantity;
        prize_acc.total_amount = add_amount;
    }

    // Update gumball counters
    gumball.prizes_added = gumball
        .prizes_added
        .checked_add(quantity)
        .ok_or(GumballStateErrors::Overflow)?;

    // Transfer from creator ATA to escrow ATA
    transfer_tokens(
        &ctx.accounts.creator_prize_ata,
        &ctx.accounts.prize_escrow,
        creator,
        &ctx.accounts.prize_token_program,
        prize_mint,
        add_amount,
    )?;

    // Emit event
    emit!(PrizeAdded {
        gumball_id,
        prize_index,
        prize_mint: prize_mint.key(),
        prize_amount,
        quantitiy: quantity,
        added_at: now,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(gumball_id: u32, prize_index: u16)]
pub struct AddPrize<'info> {
    #[account(
        seeds = [b"gumball"],
        bump = gumball_config.config_bump,
        constraint = gumball_admin.key() == gumball_config.gumball_admin @ ConfigStateErrors::InvalidGumballAdmin,
    )]
    pub gumball_config: Box<Account<'info, GumballConfig>>,

    #[account(
        mut,
        seeds = [b"gumball", gumball_id.to_le_bytes().as_ref()],
        bump = gumball.gumball_bump,
        constraint = gumball.gumball_id == gumball_id @ GumballStateErrors::InvalidGumballId
    )]
    pub gumball: Box<Account<'info, GumballMachine>>,

    #[account(
        init_if_needed, 
        payer = creator, 
        space = 8 + Prize::INIT_SPACE, 
        seeds = [b"gumball", gumball_id.to_le_bytes().as_ref(), prize_index.to_le_bytes().as_ref()],
        bump
    )]
    pub prize: Box<Account<'info, Prize>>,

    #[account(
        mut,
        constraint = gumball.creator == creator.key() @ GumballStateErrors::InvalidCreator
    )]
    pub creator: Signer<'info>,

    pub gumball_admin: Signer<'info>,

    pub prize_mint: InterfaceAccount<'info, Mint>,

    // Ticket escrow ATA (create ATA to store the tickets amount from the buyers and owner of the ATA is the gumball account, if ticket mint != sol)
    #[account(
        init_if_needed,
        payer = creator,
        associated_token::mint = prize_mint,
        associated_token::authority = gumball,
        associated_token::token_program = prize_token_program
    )]
    pub prize_escrow: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = prize_mint,
        associated_token::authority = creator,
        associated_token::token_program = prize_token_program
    )]
    pub creator_prize_ata: InterfaceAccount<'info, TokenAccount>,

    pub prize_token_program: Interface<'info, TokenInterface>,
 
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
