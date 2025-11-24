use anchor_lang::prelude::*;

#[error_code]
pub enum RaffleStateErrors {
    #[msg("Invalid Raffle ID")]
    InvalidRaffleId,

    #[msg("Invalid Raffle Creator")]
    InvalidCreator,

    #[msg("Raffle is already started")]
    RaffleAlreadyStarted,

    #[msg("Start time is not reached")]
    StartTimeNotReached,

    #[msg("End time is not reached")]
    EndTimeNotReached,

    #[msg("End time is crossed")]
    EndTimeIsCrossed,

    #[msg("Start time should be greater than current time")]
    StartTimeInPast,

    #[msg("Calculation Overflow Error")]
    Overflow,

    #[msg("Invalid NFT")]
    InvalidNFT,

    #[msg("Invalid Winner Index")]
    InvalidWinnerIndex,

    #[msg("Invalid zero prize for winner")]
    ZeroPrizeForWinner,

    #[msg("Invalid Winner claim")]
    InvalidWinner,

    #[msg("Prize is already claimed")]
    PrizeAlreadyClaimed,

    #[msg("Raffle state should be in Initialized or Active")]
    InvalidRaffleStateForCancel,

    #[msg("Raffle is not ended")]
    RaffleNotEnded,

    #[msg("Invalid Zero Amount")]
    InvalidZeroAmount,

    #[msg("Invalid maximum wallet per pct")]
    InvalidMaxPerWalletPct,

    #[msg("Winners count exceed maximum")]
    ExceedMaxWinners,

    #[msg("Invalid zero winners count")]
    InvalidZeroWinnersCount,

    #[msg("Insufficient prize amount")]
    InsufficientPrizeAmount,

    #[msg("Raffle State not in Initialized state")]
    StateShouldBeInInitialized,

    #[msg("Invalid raffle state for update")]
    InvalidRaffleStateForUpdate,

    #[msg("Raffle is not Successfully ended")]
    RaffleNotSuccessEnded,

    #[msg("Raffle is not active")]
    RaffleNotActive,

    #[msg("Invalid winners length")]
    InvalidWinnersLength,

    #[msg("Duplicate Winners are not allowed")]
    DuplicateWinnersNotAllowed,

    #[msg("Invalid win shares")]
    InvalidWinShares,

    #[msg("More than one ticket is solded")]
    MoreThanOneTicketSolded,

    #[msg("Cannot update winners for NFT prize")]
    CannotUpdateWinnersForNftPrize,

    #[msg("Start time do not exceed end time")]
    StartTimeExceedEndTime,

    #[msg("Invalid zero tickets")]
    InvalidZeroTickets,

    #[msg("Tickets are sold out")]
    TicketsSoldOut,

    #[msg("Invalid ticket zero price")]
    InvalidTicketZeroPrice,

    #[msg("Invalid total tickets")]
    InvalidTotalTickets,

    #[msg("Total tickets should be greater than winners count")]
    WinnersExceedTotalTickets,

    #[msg("Maximum Tickets Per Wallet Exceeded")]
    MaxTicketsPerWalletExceeded,
}

#[error_code]
pub enum KeysMismatchErrors {
    #[msg("Invalid Ticket Mint")]
    InvalidTicketMint,

    #[msg("Missing Ticket Mint")]
    MissingTicketMint,

    #[msg("Invalid Ticket Escrow")]
    InvalidTicketEscrow,

    #[msg("Missing Ticket Escrow")]
    MissingTicketEscrow,

    #[msg("Invalid Ticket Program")]
    InvalidTicketTokenProgram,

    #[msg("Invalid Prize Mint")]
    InvalidPrizeMint,

    #[msg("Missing Prize Mint")]
    MissingPrizeMint,

    #[msg("Invalid Prize Escrow")]
    InvalidPrizeEscrow,

    #[msg("Missing Prize Escrow")]
    MissingPrizeEscrow,

    #[msg("Invalid Prize Escrow Owner")]
    InvalidPrizeEscrowOwner,

    #[msg("Invalid Prize Program")]
    InvalidPrizeTokenProgram,

    #[msg("Invalid Fee Treasury ATA Owner")]
    InvalidFeeTreasuryAtaOwner,

    #[msg("Invalid Buyer Account User")]
    InvalidBuyerAccountUser,

    #[msg("Invalid Ticket ATA Owner")]
    InvalidTicketAtaOwner,

    #[msg("Invalid Prize ATA Owner")]
    InvalidPrizeAtaOwner,

    #[msg("Invalid winner prize ATA Owner")]
    InvalidWinnerPrizeAtaOwner,

    #[msg("Invalid ticket escrow ownner")]
    InvalidTicketEscrowOwner,
}

#[error_code]
pub enum ConfigStateErrors {
    #[msg("Invalid Raffle Owner")]
    InvalidRaffleOwner,

    #[msg("Invalid Raffle Admin")]
    InvalidRaffleAdmin,

    #[msg("Raffle should be between min & max periods")]
    InvalidRafflePeriod,
}

#[error_code]
pub enum TransferErrors {
    #[msg("Token transfer failed")]
    TokenTransferFailed,

    #[msg("SOL transfer failed")]
    SolTransferFailed,

    #[msg("Insufficient SPL Token Balance")]
    InsufficientTokenBalance,

    #[msg("Insufficient SOL Token Balance")]
    InsufficientSolBalance,
}
