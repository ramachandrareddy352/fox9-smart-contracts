use anchor_lang::prelude::*;

#[error_code]
pub enum RaffleErrors {
    #[msg("Invalid Raffle Owner")]
    InvalidRaffleOwner,

    #[msg("Invalid Raffle Admin")]
    InvalidRaffleAdmin,

    #[msg("Token transfer failed")]
    TokenTransferFailed,

    #[msg("SOL transfer failed")]
    SolTransferFailed,

    #[msg("Failed to close the account")]
    CloseAccountFailed,

    #[msg("Expected ATA is not matched")]
    InvalidAtaAddressMismatch,

    #[msg("Failed to create ATA account")]
    AtaCreationFailed,

    #[msg("Insufficient SPL Token Balance")]
    InsufficientTokenBalance,

    #[msg("Insufficient SOL Token Balance")]
    InsufficientSolBalance,

    #[msg("Overflow Error")]
    Overflow,
}
