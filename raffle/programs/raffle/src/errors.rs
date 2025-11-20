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

    #[msg("Invalid Raffle period")]
    InvalidRafflePeriod,

    #[msg("Invalid Raffle tickets")]
    InvalidRaffleTickets,

    #[msg("Invalid Maximum Wallet per PCT")]
    InvalidMaximumWalletPCT,

    #[msg("Invalid Maximum Winners Count")]
    InvalidMaximumWinnersCount,

    #[msg("Invalid Winners count")]
    InvalidWinnersCount,

    #[msg("Ticket price should be greater than zero")]
    InvalidTicketZeroPrice,

    #[msg("Invalid Total Tickets")]
    InvalidTotalTickets,

    #[msg("Invalid zero winners count")]
    InvalidZeroWinnersCount,

    #[msg("Winners exceed total tickets")]
    WinnersExceedTotalTickets,

    #[msg("Exceed maximum winners")]
    ExceedMaxWinners,

    #[msg("Invalid zero prize amount")]
    InvalidZeroPrizeAmount,

    #[msg("Insufficient prize amount")]
    InsufficientPrizeAmount,

    #[msg("Invalid win shares length")]
    InvalidWinSharesLength,

    #[msg("Invalid zero share winner")]
    InvalidZeroShareWinner,

    #[msg("Invalid win shares")]
    InvalidWinShares,

    #[msg("Start time exceeds end time")]
    StartTimeExceedEndTime,

    #[msg("Start time in the past")]
    StartTimeInPast,

    #[msg("Invalid max per wallet pct")]
    InvalidMaxPerWalletPct,

    #[msg("Invalid prize owner")]
    InvalidPrizeOwner,

    #[msg("Invalid creator prize mint")]
    InvalidCreatorPrizeMint,

    #[msg("Invalid creator prize ATA owner")]
    InvalidCreatorPrizeAtaOwner,

    #[msg("Invalid token program")]
    InvalidTokenProgram,

    #[msg("Invalid NFT decimals")]
    InvalidNftDecimals,

    #[msg("Invalid NFT supply")]
    InvalidNftSupply,
}
