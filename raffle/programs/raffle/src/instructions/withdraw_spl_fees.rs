use crate::errors::ConfigStateErrors;
use crate::helpers::transfer_tokens_with_seeds;
use crate::states::RaffleConfig;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

#[event]
pub struct SplFeesWithdrawn {
    pub amount: u64,
    pub mint: Pubkey,
    pub receiver: Pubkey,
}

// Withdraw accumulated SPL fees from the treasury ATA, Only the raffle owner can withdraw
pub fn withdraw_spl_fees(ctx: Context<WithdrawSplFees>, amount: u64) -> Result<()> {
    let config = &ctx.accounts.raffle_config;

    let signer_seeds: &[&[&[u8]]] = &[&[b"raffle", &[config.config_bump]]];

    transfer_tokens_with_seeds(
        &ctx.accounts.fee_treasury_ata,
        &ctx.accounts.receiver_fee_ata,
        &ctx.accounts.raffle_config.to_account_info(),
        &ctx.accounts.token_program,
        &ctx.accounts.fee_mint,
        signer_seeds,
        amount,
    )?;

    emit!(SplFeesWithdrawn {
        amount,
        mint: ctx.accounts.fee_mint.key(),
        receiver: ctx.accounts.owner.key(),
    });

    Ok(())
}

#[derive(Accounts)]
pub struct WithdrawSplFees<'info> {
    #[account(
        mut,
        seeds = [b"raffle"],
        bump = raffle_config.config_bump,
        constraint = raffle_config.raffle_owner == owner.key() @ ConfigStateErrors::InvalidRaffleOwner
    )]
    pub raffle_config: Account<'info, RaffleConfig>,

    #[account(mut)]
    pub owner: Signer<'info>,

    // The mint of the fee token being withdrawn
    pub fee_mint: InterfaceAccount<'info, Mint>,

    // Treasury ATA (holds fees) — owned by raffle_config PDA
    #[account(
        mut,
        associated_token::mint = fee_mint,
        associated_token::authority = raffle_config,
    )]
    pub fee_treasury_ata: InterfaceAccount<'info, TokenAccount>,

    // Owner's ATA — will receive the fees
    #[account(mut)]
    pub receiver_fee_ata: InterfaceAccount<'info, TokenAccount>,

    // Programs
    pub token_program: Interface<'info, TokenInterface>,

    pub system_program: Program<'info, System>,
}
