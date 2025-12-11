use anchor_lang::prelude::*;
use crate::errors::{ConfigStateErrors, TransferErrors};
use crate::helpers::transfer_sol_with_seeds;
use crate::states::AuctionConfig;

#[event]
pub struct FeesWithdrawn {
    pub amount: u64,
    pub receiver: Pubkey,
}

pub fn withdraw_sol_fees(ctx: Context<WithdrawSolFees>, amount: u64) -> Result<()> {
    let config = &ctx.accounts.auction_config;
    let pda_ai = config.to_account_info();

    // Rent-exempt check
    let rent = Rent::get()?;
    let min_rent = rent.minimum_balance(pda_ai.data_len());

    require!(
        pda_ai.lamports() >= min_rent + amount,
        TransferErrors::InsufficientSolBalance
    );

    let signer_seeds: &[&[&[u8]]] = &[&[b"auction", &[config.config_bump]]];

    transfer_sol_with_seeds(
        &pda_ai,
        &ctx.accounts.receiver,
        amount,
    )?;

    emit!(FeesWithdrawn {
        amount,
        receiver: ctx.accounts.receiver.key()
    });

    Ok(())
}

#[derive(Accounts)]
pub struct WithdrawSolFees<'info> {
    #[account(
        mut, 
        seeds = [b"auction"], 
        bump = auction_config.config_bump, 
        constraint = auction_config.auction_owner == owner.key() @ConfigStateErrors::InvalidAuctionOwner)]
    pub auction_config: Account<'info, AuctionConfig>,

    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(mut)]
    /// CHECK: receiver may be PDA or wallet address
    pub receiver: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}
