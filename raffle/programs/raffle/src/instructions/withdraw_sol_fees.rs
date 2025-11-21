use crate::errors::RaffleErrors;
use crate::helpers::transfer_sol_with_seeds;
use crate::states::RaffleConfig;
use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, System};

pub fn withdraw_sol_fees(ctx: Context<WithdrawSolFees>, amount: u64) -> Result<()> {
    let config = &ctx.accounts.raffle_config;
    let owner = &ctx.accounts.owner;

    require_gt!(amount, 0, RaffleErrors::InvalidZeroAmount);

    // Rent-exempt check
    let pda_ai = config.to_account_info();
    let rent = Rent::get()?;
    let min_rent = rent.minimum_balance(pda_ai.data_len());

    require!(
        pda_ai.lamports() >= min_rent + amount,
        RaffleErrors::InsufficientFundsForWithdrawal
    );

    //  Receiver validation (prevent sending to PDAs / token accounts)
    require!(
        ctx.accounts.receiver.is_writable,
        RaffleErrors::ReceiverNotWritable
    );
    require_keys_eq!(
        ctx.accounts.receiver.owner,
        system_program::ID,
        RaffleErrors::InvalidReceiverOwner
    );

    let signer_seeds: &[&[&[u8]]] = &[&[b"raffle", &[config.config_bump]]];

    // Transfer using your helper
    transfer_sol_with_seeds(
        &pda_ai,
        &ctx.accounts.receiver.to_account_info(),
        &ctx.accounts.system_program,
        signer_seeds,
        amount,
    )?;

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
        seeds = [b"raffle"],
        bump = raffle_config.config_bump,
        constraint = raffle_config.raffle_owner == owner.key() @ RaffleErrors::InvalidRaffleOwner,
    )]
    pub raffle_config: Box<Account<'info, RaffleConfig>>,

    /// Must be the config owner (not admin)
    #[account(mut)]
    pub owner: Signer<'info>,

    /// Any writable system-owned account (wallet)
    #[account(mut)]
    pub receiver: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}
