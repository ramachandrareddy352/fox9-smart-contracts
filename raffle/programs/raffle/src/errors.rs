use anchor_lang::prelude::*;

#[error_code]
pub enum RaffleErrors {
    #[msg("Invalid Raffle Owner")]
    InvalidRaffleOwner,

    #[msg("Invalid Raffle Admin")]
    InvalidRaffleAdmin,

    #[msg("Invalid Raffle period values")]
    InvalidRafflePeriod,

    #[msg("Maximum winnners count exceed 100")]
    ExceedWinnersCount,

    #[msg("Token transfer failed")]
    TokenTransferFailed,

    #[msg("SOL transfer failed")]
    SolTransferFailed,
}
