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
    let config = &ctx.accounts.raffle_config;
    let pda_ai = config.to_account_info();

    // Rent-exempt check
    let rent = Rent::get()?;
    let min_rent = rent.minimum_balance(pda_ai.data_len());

    require!(
        pda_ai.lamports() >= min_rent + amount,
        TransferErrors::InsufficientSolBalance
    );

    let signer_seeds: &[&[&[u8]]] = &[&[b"raffle", &[config.config_bump]]];

    // Transfer using your helper
    transfer_sol_with_seeds(
        &pda_ai,
        &ctx.accounts.owner,
        &ctx.accounts.system_program,
        signer_seeds,
        amount,
    )?;

    emit!(FeesWithdrawn {
        amount,
        receiver: ctx.accounts.owner.key(),
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

    pub system_program: Program<'info, System>,
}
