use crate::errors::RaffleErrors;
use crate::states::RaffleConfig;
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

/// Withdraw SPL fee tokens stored inside the RaffleConfig PDA's ATA. Only the config owner can withdraw.
pub fn withdraw_spl_fees(ctx: Context<WithdrawSplFees>, amount: u64) -> Result<()> {
    let config = &ctx.accounts.raffle_config;
    let owner = &ctx.accounts.owner;
    let fee_ata = &ctx.accounts.fee_treasury_ata;

    // Check balance in PDA’s fee ATA
    require_gte!(
        fee_ata.amount,
        amount,
        RaffleErrors::InsufficientFundsForWithdrawal
    );

    // PDA signature seeds
    let signer_seeds: &[&[&[u8]]] = &[&[b"raffle", &[config.config_bump]]];

    // Transfer SPL tokens (checked)
    transfer_tokens_with_seeds(
        fee_ata,
        &ctx.accounts.owner_fee_ata,
        &config.to_account_info(),
        &ctx.accounts.token_program,
        signer_seeds,
        amount,
    )?;

    emit!(SplFeesWithdrawn {
        amount,
        mint: ctx.accounts.fee_mint.key(),
        receiver: ctx.accounts.owner_fee_ata.key(),
    });

    Ok(())
}

#[derive(Accounts)]
pub struct WithdrawSplFees<'info> {
    #[account(
        mut,
        seeds = [b"raffle"],
        bump = raffle_config.config_bump,
        constraint = raffle_config.raffle_owner == owner.key() @ RaffleErrors::InvalidRaffleOwner
    )]
    pub raffle_config: Box<Account<'info, RaffleConfig>>,

    /// Must be the raffle owner (NOT admin)
    #[account(mut)]
    pub owner: Signer<'info>,

    /// Mint of the SPL token to withdraw
    pub fee_mint: Box<InterfaceAccount<'info, Mint>>,

    /// ATA owned by RaffleConfig PDA (SPL fees stored here)
    #[account(
        mut,
        token::mint = fee_mint,
        token::authority = raffle_config,
    )]
    pub fee_treasury_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Owner’s ATA (SPL fees will be transferred here)
    #[account(
        init_if_needed
        payer = owner,
        associated_token::mint = fee_mint,
        associated_token::authority = owner,
        associated_token::token_program = token_program,
    )]
    pub owner_fee_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    // Programs
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
