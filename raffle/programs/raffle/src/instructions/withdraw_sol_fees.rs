use crate::errors::{ConfigStateErrors, TransferErrors};
use crate::helpers::transfer_sol_with_seeds;
use crate::states::RaffleConfig;
use anchor_lang::prelude::*;
use anchor_lang::system_program::System;

#[event]
pub struct FeesWithdrawn {
    pub amount: u64,
    pub receiver: Pubkey,
}

pub fn withdraw_sol_fees(ctx: Context<WithdrawSolFees>, amount: u64) -> Result<()> {
    let raffle_config = &ctx.accounts.raffle_config;
    let from = raffle_config.to_account_info();
    let to = ctx.accounts.receiver.to_account_info();

    // Rent-exempt check for the source PDA
    let rent = Rent::get()?;
    let min_rent = rent.minimum_balance(from.data_len());

    require!(
        from.lamports() > min_rent + amount,
        TransferErrors::InsufficientSolBalance
    );

    // Move lamports directly (no CPI needed; program owns raffle_config)
    **from.try_borrow_mut_lamports()? -= amount;
    **to.try_borrow_mut_lamports()? += amount;

    emit!(FeesWithdrawn {
        amount,
        receiver: to.key(),
    });

    Ok(())
}

#[derive(Accounts)]
pub struct WithdrawSolFees<'info> {
    #[account(
        mut,
        seeds = [b"raffle"],
        bump = raffle_config.config_bump,
        constraint = raffle_config.raffle_owner == owner.key() @ ConfigStateErrors::InvalidRaffleOwner,
    )]
    pub raffle_config: Account<'info, RaffleConfig>,

    // Must be the config owner (not admin)
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(mut)]
    /// CHECK: receiver may be PDA or wallet address
    pub receiver: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}
 