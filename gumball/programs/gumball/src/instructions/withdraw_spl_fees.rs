use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use crate::errors::ConfigStateErrors;
use crate::helpers::transfer_tokens_with_seeds;
use crate::states::GumballConfig;

#[event]
pub struct SplFeesWithdrawn {
    pub amount: u64,
    pub mint: Pubkey,
    pub receiver: Pubkey,
}

// Withdraw accumulated SPL fees from the treasury ATA, Only the gumball owner can withdraw
pub fn withdraw_spl_fees(ctx: Context<WithdrawSplFees>, amount: u64) -> Result<()> {
    let config = &ctx.accounts.gumball_config;

    let signer_seeds: &[&[&[u8]]] = &[&[b"gumball", &[config.config_bump]]];

    transfer_tokens_with_seeds(
        &ctx.accounts.fee_treasury_ata,
        &ctx.accounts.receiver_fee_ata,
        &ctx.accounts.gumball_config.to_account_info(),
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
        seeds = [b"gumball"],
        bump = gumball_config.config_bump,
        constraint = gumball_config.gumball_owner == owner.key() @ ConfigStateErrors::InvalidGumballOwner
    )]
    pub gumball_config: Account<'info, GumballConfig>,

    #[account(mut)]
    pub owner: Signer<'info>,

    // The mint of the fee token being withdrawn
    pub fee_mint: InterfaceAccount<'info, Mint>,

    // Treasury ATA (holds fees) — owned by gumball_config PDA
    #[account(
        mut,
        associated_token::mint = fee_mint,
        associated_token::authority = gumball_config,
    )]
    pub fee_treasury_ata: InterfaceAccount<'info, TokenAccount>,

    // Owner's ATA — will receive the fees
    #[account(mut)]
    pub receiver_fee_ata: InterfaceAccount<'info, TokenAccount>,

    // Programs
    pub token_program: Interface<'info, TokenInterface>,
    
    pub system_program: Program<'info, System>,
}
