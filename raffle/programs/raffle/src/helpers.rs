use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::{
    associated_token::{create, get_associated_token_address, AssociatedToken, Create},
    token_interface::{close_account, transfer, TokenAccount, TokenInterface},
};

/// Close a token account using PDA authority.
/// Rent is transferred to `destination`.
pub fn close_token_account_with_seeds<'info>(
    account: &InterfaceAccount<'info, TokenAccount>,
    destination: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    token_program: &Interface<'info, TokenInterface>,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    close_account(CpiContext::new_with_signer(
        token_program.to_account_info(),
        anchor_spl::token_interface::CloseAccount {
            account: account.to_account_info(),
            destination: destination.to_account_info(),
            authority: authority.to_account_info(),
        },
        signer_seeds,
    ))
    .map_err(|_| err!(RaffleError::CloseAccountFailed))?
}

/// Transfer SPL Tokens With PDA Seeds
/// Requires sufficient balance in `from`.
pub fn transfer_tokens_with_seeds<'info>(
    from: &InterfaceAccount<'info, TokenAccount>,
    to: &InterfaceAccount<'info, TokenAccount>,
    authority: &AccountInfo<'info>,
    token_program: &Interface<'info, TokenInterface>,
    signer_seeds: &[&[&[u8]]],
    amount: u64,
) -> Result<()> {
    require!(from.amount >= amount, RaffleError::InsufficientTokenBalance);
    transfer(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            anchor_spl::token_interface::Transfer {
                from: from.to_account_info(),
                to: to.to_account_info(),
                authority: authority.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
    )
    .map_err(|_| err!(RaffleError::TokenTransferFailed))?
}

/// Transfer SPL Tokens (normal signer authority)
/// Requires sufficient balance in `from`.
pub fn transfer_tokens<'info>(
    from: &InterfaceAccount<'info, TokenAccount>,
    to: &InterfaceAccount<'info, TokenAccount>,
    authority: &Signer<'info>,
    token_program: &Interface<'info, TokenInterface>,
    amount: u64,
) -> Result<()> {
    require!(from.amount >= amount, RaffleError::InsufficientTokenBalance);
    transfer(
        CpiContext::new(
            token_program.to_account_info(),
            anchor_spl::token_interface::Transfer {
                from: from.to_account_info(),
                to: to.to_account_info(),
                authority: authority.to_account_info(),
            },
        ),
        amount,
    )
    .map_err(|_| err!(RaffleError::TokenTransferFailed))?
}

/// Create ATA (Associated Token Account) if missing
/// Skips if the account already exists and is a valid ATA.
pub fn create_ata<'info>(
    payer: &AccountInfo<'info>,
    ata_account: &AccountInfo<'info>,
    owner: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    token_program: &AccountInfo<'info>,
    ata_program: &Program<'info, AssociatedToken>,
) -> Result<()> {
    // Derive expected ATA address
    let ata_expected = get_associated_token_address(&owner.key(), &mint.key());

    // Validate ATA address
    require_keys_eq!(
        ata_account.key(),
        ata_expected,
        RaffleError::InvalidAtaAddressMismatch
    );

    // If data is not empty, assume it exists (basic check; for production, add deserialization validation)
    if !ata_account.data_is_empty() {
        return Ok(());
    }

    // Prepare CPI accounts
    let cpi_accounts = Create {
        payer: (*payer).clone(),
        associated_token: ata_account.clone(),
        authority: owner.clone(),
        mint: mint.clone(),
        system_program: system_program.clone(),
        token_program: token_program.clone(),
    };

    let cpi_program = ata_program.to_account_info();
    create(CpiContext::new(cpi_program, cpi_accounts))
        .map_err(|_| err!(RaffleError::AtaCreationFailed))?;

    Ok(())
}

/// Transfer SOL using PDA seeds
/// Requires sufficient lamports in `from`.
pub fn transfer_sol_with_seeds<'info>(
    from: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    system_program: &Program<'info, System>,
    signer_seeds: &[&[&[u8]]],
    amount: u64,
) -> Result<()> {
    require!(
        from.lamports() >= amount,
        RaffleError::InsufficientSolBalance
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
    )
    .map_err(|_| err!(RaffleError::SolTransferFailed))?
}

/// Transfer SOL from normal signer
/// Requires sufficient lamports in `from`.
pub fn transfer_sol_from_signer<'info>(
    from: &Signer<'info>,
    to: &AccountInfo<'info>,
    system_program: &Program<'info, System>,
    amount: u64,
) -> Result<()> {
    require!(
        from.lamports() >= amount,
        RaffleError::InsufficientSolBalance
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
    )
    .map_err(|_| err!(RaffleError::SolTransferFailed))?
}
