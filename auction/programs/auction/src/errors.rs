use anchor_lang::prelude::*;

#[error_code]
pub enum AuctionStateErrors {
    #[msg("Invalid Auction ID")]
    InvalidAuctionId,

    #[msg("Invalid Auction Creator")]
    InvalidCreator,

    #[msg("End time not reached")]
    EndTimeNotReached,

    #[msg("Particular Function is paused")]
    FunctionPaused,

    #[msg("Calculation Overflow Error")]
    Overflow,

    #[msg("Invalid zero amount")]
    InvalidZeroAmount,

    #[msg("Start time exceed end time or invalid duration")]
    StartTimeExceedEndTime,

    #[msg("Start time should be greater than current time")]
    StartTimeInPast,

    #[msg("Auction already started")]
    AuctionAlreadyStarted,

    #[msg("Auction not started yet")]
    AuctionNotStarted,

    // -----------
    #[msg("Auction not active")]
    AuctionNotActive,

    #[msg("Auction already completed")]
    AuctionAlreadyCompleted,

    #[msg("Invalid auction time extension")]
    InvalidAuctionTimeExtension,

    #[msg("Auction has bids and cannot be cancelled")]
    AuctionHasBids,

    #[msg("Invalid NFT (must be a single-supply token with 0 decimals)")]
    InvalidNFT,

    #[msg("Bid amount is too low")]
    BidTooLow,

    #[msg("Bid increase is smaller than minimum increment")]
    BidBelowIncrement,

    #[msg("Cannot bid: caller is current highest bidder")]
    CannotBidOwnHighBid,

    #[msg("No bids present")]
    NoBidsPresent,

    #[msg("Insufficient balance to place bid")]
    InsufficientBalance,
}

#[error_code]
pub enum KeysMismatchErrors {
    #[msg("Invalid Prize Mint")]
    InvalidPrizeMint,

    #[msg("Invalid Prize Escrow")]
    InvalidPrizeEscrow,

    #[msg("Invalid Prize Escrow Owner")]
    InvalidPrizeEscrowOwner,

    #[msg("Invalid Prize ATA owner")]
    InvalidPrizeAtaOwner,

    #[msg("Invalid Bid Token Mint")]
    InvalidBidMint,

    #[msg("Missing Bid Mint")]
    MissingBidMint,

    #[msg("Invalid Bid Escrow")]
    InvalidBidEscrow,

    #[msg("Invalid Bid Escrow Owner")]
    InvalidBidEscrowOwner,

    #[msg("Invalid Bid ATA owner")]
    InvalidBidAtaOwner,

    #[msg("Invalid previous bid owner")]
    InvalidPreviousBidOwner,

    #[msg("Invalid highest bidder")]
    InvalidHighestBidder
}

#[error_code]
pub enum ConfigStateErrors {
    #[msg("Invalid Auction Owner")]
    InvalidAuctionOwner,

    #[msg("Invalid Auction Admin")]
    InvalidAuctionAdmin,

    #[msg("Auction period should be between min & max")]
    InvalidAuctionPeriod,

    #[msg("Invalid Time extension")]
    InvalidTimeExtension,
}

#[error_code]
pub enum TransferErrors {
    #[msg("Token transfer failed")]
    TokenTransferFailed,

    #[msg("SOL transfer failed")]
    SolTransferFailed,

    #[msg("Insufficient SPL Token Balance")]
    InsufficientTokenBalance,

    #[msg("Insufficient SOL Balance")]
    InsufficientSolBalance,
}
