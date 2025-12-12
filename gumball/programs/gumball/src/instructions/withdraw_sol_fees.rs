use crate::errors::{ConfigStateErrors, TransferErrors};
use crate::states::GumballConfig;
use anchor_lang::prelude::*;
use anchor_lang::system_program::System;

#[event]
pub struct FeesWithdrawn {
    pub amount: u64,
    pub receiver: Pubkey,
}

pub fn withdraw_sol_fees(ctx: Context<WithdrawSolFees>, amount: u64) -> Result<()> {
    let config = &ctx.accounts.gumball_config;
    let pda_ai = config.to_account_info();

    // Rent-exempt check
    let rent = Rent::get()?;
    let min_rent = rent.minimum_balance(pda_ai.data_len());

    require!(
        pda_ai.lamports() >= min_rent + amount,
        TransferErrors::InsufficientSolBalance
    );

    // Transfer directely
    **pda_ai.try_borrow_mut_lamports()? -= amount;
    **ctx.accounts.receiver.try_borrow_mut_lamports()? += amount;

    emit!(FeesWithdrawn {
        amount,
        receiver: ctx.accounts.receiver.key(),
    });

    Ok(())
}

#[derive(Accounts)]
pub struct WithdrawSolFees<'info> {
    #[account(
        mut,
        seeds = [b"gumball"],
        bump = gumball_config.config_bump,
        constraint = gumball_config.gumball_owner == owner.key() @ ConfigStateErrors::InvalidGumballOwner,
    )]
    pub gumball_config: Account<'info, GumballConfig>,

    // Must be the config owner (not admin)
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(mut)]
    pub receiver: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}
