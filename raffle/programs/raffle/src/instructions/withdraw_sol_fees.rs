use crate::errors::RaffleErrors;
use crate::states::RaffleConfig;
use anchor_lang::prelude::*;
use anchor_lang::system_program;

/// Withdraw SOL fees accumulated inside the RaffleConfig PDA. Only the config owner can withdraw.
pub fn withdraw_sol_fees(ctx: Context<WithdrawSolFees>, amount: u64) -> Result<()> {
    let config = &ctx.accounts.raffle_config;
    let owner = &ctx.accounts.owner;

    require_keys_eq!(
        config.raffle_owner,
        owner.key(),
        RaffleErrors::InvalidConfigOwner
    );

    // Check PDA balance
    let pda_balance = ctx.accounts.raffle_config.to_account_info().lamports();
    require!(pda_balance > 0, RaffleErrors::NoFundsToWithdraw);

    // Compute minimum rent exemption
    let rent = Rent::get()?;
    let min_rent = rent.minimum_balance(RaffleConfig::INIT_SPACE + 8);

    // Ensure withdrawn amount does not take PDA below rent exempt
    require!(
        pda_balance.saturating_sub(amount) >= min_rent,
        RaffleErrors::InsufficientFundsForWithdrawal
    );

    // Transfer lamports (PDA -> receiver)
    let config_ai = ctx.accounts.raffle_config.to_account_info();
    let receiver_ai = ctx.accounts.receiver.to_account_info();

    let seeds: &[&[u8]] = &[b"raffle", &[config.config_bump]];
    let signer_seeds: &[&[&[u8]]] = &[seeds];

    system_program::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: config_ai,
                to: receiver_ai,
            },
            signer_seeds,
        ),
        amount,
    )?;

    Ok(())
}

#[derive(Accounts)]
pub struct WithdrawSolFees<'info> {
    #[account(
        mut,
        seeds = [b"raffle"],
        bump = raffle_config.config_bump
    )]
    pub raffle_config: Account<'info, RaffleConfig>,

    /// Must be the config owner (NOT admin)
    #[account(mut)]
    pub owner: Signer<'info>,

    /// Receiver account (any wallet chosen by owner)
    #[account(mut)]
    pub receiver: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}
