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

    // Check balance in PDA’s fee ATA
    let fee_ata = &ctx.accounts.fee_treasury_ata;
    require_gte!(
        fee_ata.amount,
        amount,
        RaffleErrors::InsufficientFundsForWithdrawal
    );

    // Ensure owner ATA exists, create it if missing
    let owner_ata = &ctx.accounts.owner_fee_ata;

    if owner_ata.amount == 0 && owner_ata.owner != owner.key() {
        // Create ATA (payer = owner)
        anchor_spl::associated_token::create(CpiContext::new(
            ctx.accounts.associated_token_program.to_account_info(),
            anchor_spl::associated_token::Create {
                payer: owner.to_account_info(),
                associated_token: owner_ata.to_account_info(),
                authority: owner.to_account_info(),
                mint: ctx.accounts.fee_mint.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                token_program: ctx.accounts.token_program.to_account_info(),
            },
        ))?;
    }

    // PDA signature seeds
    let seeds: &[&[u8]] = &[b"raffle", &[config.config_bump]];
    let signer_seeds: &[&[&[u8]]] = &[seeds];

    // Transfer SPL tokens (checked)
    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: fee_ata.to_account_info(),
                to: owner_ata.to_account_info(),
                authority: ctx.accounts.raffle_config.to_account_info(),
                mint: ctx.accounts.fee_mint.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
        ctx.accounts.fee_mint.decimals,
    )?;

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
    pub raffle_config: Account<'info, RaffleConfig>,

    /// Must be the raffle owner (NOT admin)
    #[account(mut)]
    pub owner: Signer<'info>,

    /// Mint of the SPL token used for ticket payments
    pub fee_mint: InterfaceAccount<'info, Mint>,

    /// ATA owned by RaffleConfig PDA (SPL fees stored here)
    #[account(
        mut,
        constraint = fee_treasury_ata.owner == raffle_config.key() @ RaffleErrors::InvalidFeeTreasuryOwner,
        constraint = fee_treasury_ata.mint == fee_mint.key() @ RaffleErrors::InvalidFeeMint
    )]
    pub fee_treasury_ata: InterfaceAccount<'info, TokenAccount>,

    /// Owner’s ATA (SPL fees will be transferred here)
    #[account(
        mut,
        constraint = owner_fee_ata.mint == fee_mint.key() @ RaffleErrors::InvalidFeeMint
    )]
    pub owner_fee_ata: InterfaceAccount<'info, TokenAccount>,

    // Programs
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
