use anchor_lang::prelude::*;
use anchor_lang::system_program::{self};
use anchor_spl::token_interface::{
    Mint,
    TokenAccount,
    TokenInterface,
    TransferChecked,
    transfer_checked,
};
use crate::errors::TransferErrors;

// Transfer SPL Tokens With PDA Seeds — SAFE (uses transfer_checked)
pub fn transfer_tokens_with_seeds<'info>(
    from: &InterfaceAccount<'info, TokenAccount>,
    to: &InterfaceAccount<'info, TokenAccount>,
    authority: &AccountInfo<'info>,
    token_program: &Interface<'info, TokenInterface>,
    mint: &InterfaceAccount<'info, Mint>,
    signer_seeds: &[&[&[u8]]],
    amount: u64,
) -> Result<()> {
    require!(
        from.amount >= amount,
        TransferErrors::InsufficientTokenBalance
    );

    transfer_checked(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            TransferChecked {
                from: from.to_account_info(),
                to: to.to_account_info(),
                mint: mint.to_account_info(),
                authority: authority.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
        mint.decimals,
    ).map_err(|_| TransferErrors::TokenTransferFailed.into())
}

// Transfer SPL Tokens (normal signer authority) — SAFE
pub fn transfer_tokens<'info>(
    from: &InterfaceAccount<'info, TokenAccount>,
    to: &InterfaceAccount<'info, TokenAccount>,
    authority: &Signer<'info>,
    token_program: &Interface<'info, TokenInterface>,
    mint: &InterfaceAccount<'info, Mint>,
    amount: u64,
) -> Result<()> {
    require!(
        from.amount >= amount,
        TransferErrors::InsufficientTokenBalance
    );

    transfer_checked(
        CpiContext::new(
            token_program.to_account_info(),
            TransferChecked {
                from: from.to_account_info(),
                to: to.to_account_info(),
                mint: mint.to_account_info(),
                authority: authority.to_account_info(),
            },
        ),
        amount,
        mint.decimals,
    ).map_err(|_| TransferErrors::TokenTransferFailed.into())
}

// Transfer SOL using PDA seeds
pub fn transfer_sol_with_seeds<'info>(
    from: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    system_program: &Program<'info, System>,
    signer_seeds: &[&[&[u8]]],
    amount: u64,
) -> Result<()> {
    let from_lamports = from.lamports();
    require!(
        from_lamports >= amount,
        TransferErrors::InsufficientSolBalance
    );

    system_program::transfer(
        CpiContext::new_with_signer(
            system_program.to_account_info(),
            system_program::Transfer {
                from: from.to_account_info(),
                to: to.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
    ).map_err(|_| TransferErrors::SolTransferFailed.into())
}

// Transfer SOL from normal signer
pub fn transfer_sol<'info>(
    from: &Signer<'info>,
    to: &AccountInfo<'info>,
    system_program: &Program<'info, System>,
    amount: u64,
) -> Result<()> {
    let from_lamports = from.lamports();
    require!(
        from_lamports >= amount,
        TransferErrors::InsufficientSolBalance
    );

    system_program::transfer(
        CpiContext::new(
            system_program.to_account_info(),
            system_program::Transfer {
                from: from.to_account_info(),
                to: to.to_account_info(),
            },
        ),
        amount,
    ).map_err(|_| TransferErrors::SolTransferFailed.into())
}
