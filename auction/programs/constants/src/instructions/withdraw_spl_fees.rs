use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use crate::errors::ConfigStateErrors;
use crate::helpers::transfer_tokens_with_seeds;
use crate::states::AuctionConfig;

#[event]
pub struct SplFeesWithdrawn {
    pub amount: u64,
    pub mint: Pubkey,
    pub receiver: Pubkey,
}

pub fn withdraw_spl_fees(ctx: Context<WithdrawSplFees>, amount: u64) -> Result<()> {
    let config = &ctx.accounts.auction_config;
    let signer_seeds: &[&[&[u8]]] = &[&[b"auction", &[config.config_bump]]];

    transfer_tokens_with_seeds(
        &ctx.accounts.fee_treasury_ata,
        &ctx.accounts.receiver_fee_ata,
        &ctx.accounts.auction_config.to_account_info(),
        &ctx.accounts.token_program,
        &ctx.accounts.fee_mint,
        signer_seeds,
        amount,
    )?;

    emit!(SplFeesWithdrawn {
        amount,
        mint: ctx.accounts.fee_mint.key(),
        receiver: ctx.accounts.owner.key()
    });

    Ok(())
}

#[derive(Accounts)]
pub struct WithdrawSplFees<'info> {
    #[account(
        mut, 
        seeds = [b"auction"], 
        bump = auction_config.config_bump, 
        constraint = auction_config.auction_owner == owner.key() @ConfigStateErrors::InvalidAuctionOwner
    )]
    pub auction_config: Account<'info, AuctionConfig>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub fee_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut, 
        associated_token::mint = fee_mint, 
        associated_token::authority = auction_config
    )]
    pub fee_treasury_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub receiver_fee_ata: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}
