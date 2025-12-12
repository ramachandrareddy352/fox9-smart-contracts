use anchor_lang::prelude::*;

#[error_code]
pub enum GumballStateErrors {
    #[msg("Invalid Gumball ID")]
    InvalidGumballId,

    #[msg("Invalid Gumball Creator")]
    InvalidCreator,

    #[msg("Calculation Overflow Error")]
    Overflow,

    #[msg("Function is paused")]
    FunctionPaused,

    #[msg("Invalid ticket price given")]
    InvalidTicketPrice,

    #[msg("Invalid total tickets")]
    InvalidTotalTickets,

    #[msg("End time is not reached")]
    EndTimeNotReached,

    #[msg("Start time exceed end time")]
    StartTimeExceedEndTime,

    #[msg("Given start time is in past")]
    StartTimeInPast,

    #[msg("Tickets are already solded")]
    TicketsAlreadySold,

    #[msg("Gumball is not in initialized stage")]
    NotInitialized,

    #[msg("Start time is not reached")]
    StartTimeNotReached,

    #[msg("End time is already reached")]
    EndTimeIsReached,

    #[msg("Invalid gumball state for this action")]
    InvalidGumballState,

    #[msg("Prizes exceed the total tickets allowed")]
    PrizesExceedTickets,

    #[msg("Invalid prize index")]
    InvalidPrizeIndex,

    #[msg("Invalid Remaining accounts passed")]
    InvalidRemainingAccounts,

    #[msg("Missing PDA bump for prize")]
    MissingBump,

    #[msg("Prize mint mismatch")]
    PrizeMintMismatch,

    #[msg("Prize amount mismatch")]
    PrizeAmountMismatch,

    #[msg("Cannot add NFT to an existing NFT prize PDA")]
    CannotAddExistingNftPrize,

    #[msg("Invalid NFT prize amount (NFT must have amount = 1)")]
    InvalidNftPrizeAmount,

    #[msg("Invalid NFT prize quantity (NFT quantity must be 1)")]
    InvalidNftPrizeQuantity,

    #[msg("Invalid prize amount")]
    InvalidPrizeAmount,

    #[msg("Invalid prize quantity")]
    InvalidPrizeQuantity,
}

#[error_code]
pub enum KeysMismatchErrors {
    #[msg("Invalid Ticket Mint")]
    InvalidTicketMint,

    #[msg("Missing Ticket Mint")]
    MissingTicketMint,

    #[msg("Invalid Ticket Escrow")]
    InvalidTicketEscrow,

    #[msg("Invalid Prize Mint")]
    InvalidPrizeMint,

    #[msg("Invalid Prize Escrow")]
    InvalidPrizeEscrow,

    #[msg("Invalid Prize Escrow Owner")]
    InvalidPrizeEscrowOwner,

    #[msg("Invalid Fee Treasury ATA Owner")]
    InvalidFeeTreasuryAtaOwner,

    #[msg("Invalid Buyer Account User")]
    InvalidBuyerAccountUser,

    #[msg("Invalid Ticket ATA Owner")]
    InvalidTicketAtaOwner,

    #[msg("Invalid Prize ATA Owner")]
    InvalidPrizeAtaOwner,

    #[msg("Invalid ticket escrow owner")]
    InvalidTicketEscrowOwner,

    // Newly used runtime checks
    #[msg("Invalid creator prize ATA mint")]
    InvalidCreatorPrizeAtaMint,

    #[msg("Invalid creator prize ATA owner")]
    InvalidCreatorPrizeAtaOwner,

    #[msg("Invalid prize escrow mint")]
    InvalidPrizeEscrowMint,
}

#[error_code]
pub enum ConfigStateErrors {
    #[msg("Invalid Gumball Owner")]
    InvalidGumballOwner,

    #[msg("Invalid Gumball Admin")]
    InvalidGumballAdmin,

    #[msg("Gumball should be between min & max periods")]
    InvalidGumballPeriod,
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
