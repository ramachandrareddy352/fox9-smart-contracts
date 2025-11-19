use anchor_lang::prelude::*;

// seeds = "raffle"
#[account]
#[derive(InitSpace)]
pub struct RaffleConfig {
    pub raffle_owner: Pubkey, // owner of all of the data, fees(full access control)
    pub raffle_admin: Pubkey, // the frontend manager key
    pub creation_fee_lamports: u64, // while creating the raffle the user have to pay fees Native SOL
    pub ticket_fee_bps: u16, // 100 = 1%, for every sale of ticket this % of fees is sent to owner + stakers
    pub winning_fee_bps: u16, // 100 = 1%, the fees is collected from the winners prizes(sol & spl)
    pub minimum_raffle_period: u32, // minimum period the raffle should be
    pub maximum_raffle_period: u32, // maximum peroid the raffle can be set
    pub minimum_tickets: u16, // minimum tickets have to set in a raffle, min - 3(default)
    pub maximum_tickets: u16, // maximum tickets can able to set is 10,000(default)
    pub maximum_wallet_pct: u8, // maximum percentage of tickets can able to buy for a single buyer in a single raffle, default to 40% = 40
    pub maximum_winners_count: u8, // maximum winners can be set in a raffle [1-10 max]
    pub raffle_count: u32,      // use the latest raffle count for seed, start from `1`
    pub config_bump: u8,
}

// seeds = "raffle" + `latest raffle count`
#[account]
#[derive(InitSpace)]
pub struct Raffle {
    pub raffle_id: u32,                // A unique ID for every Raffle
    pub creator: Pubkey,               // creator of the raffle
    pub start_time: i64, // creator can set it to be current time(raffle state = active) or future time(raffle state = Initialized)
    pub end_time: i64, // (end_time - start_time >= minimum_raffle_period) && (end_time - start_time <= maximum_raffle_period)
    pub total_tickets: u16, // [3 - 10,000](min - max)
    pub tickets_sold: u16, // always <= total tickets
    pub ticket_price: u64, // price in terms of selected ticket_mint token
    pub ticket_mint: Option<Pubkey>, // buyer have to use this mint to buy the ticket, If the amount have to pay in terms of Native sol then set to None or set to mint address
    pub ticker_escrow: Option<Pubkey>, // account which holds the ticket mint amount during the raffle and owner of this ticket escrow is the raffle PDA account, If Native sol then the amount is stored in Raffle PDA not in the escrow account, and if the ticket is Native sol then it is set to None to tiket escrow
    pub max_per_wallet_pct: u8, // max percentage of single wallet can buy the tickets from total tickets, check weather the percentage cannot able to buy single ticket we have to allow the single ticket to buy
    pub prize_type: PrizeType,  //  NFT = `0`, SPL = `1`, Native Sol = `2`
    pub prize_amount: u64,      // if NFT set to `0`
    pub prize_mint: Option<Pubkey>, // if None then the prize is a native sol or else it is a NFT or SPL mint
    pub price_escrow: Option<Pubkey>, // account which holds the price mint during the raffle and owner is the raffle PDA account, If Native sol then the amount is stored in Raffle PDA not in the escrow account, and if the prize is Native sol then it is set to None
    pub num_winners: u8, // [1 - 10](max 10), If the prize is NFT then the num_winners is only `1`
    pub win_shares: Vec<u8>, // 1% = 1, 100% = 100.
    pub winners: Vec<Pubkey>, // Exactly num_winners entries.
    pub is_win_claimed: Vec<bool>, // if claimed set to `1`
    pub status: RaffleState, // `0`-None, `1`-Initialized, `2`-Active, `3`-Cancelled, `4`-Ended
    pub is_unique_winners: bool, // if the winners list should be unique then set to `1`
    pub claimable_prize_back: u64, // if the total tickets solded is less than the winners count and if we call anounce winner then the remaining amounts can be claim back by the creator. and if the raffle failed to sold tickets then all amount is claimed back to creator
    pub raffle_bump: u8,
}

// seeds = "raffle" + `raffle id` + `user address`
#[account]
#[derive(InitSpace)]
pub struct Buyer {
    pub raffle_id: u32,
    pub user: Pubkey,
    pub tickets: u16,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum RaffleState {
    None,
    Initialized, // when raffle is created, but the start time is not reached the current time
    Active,      // raffle is created and current time is reached the start time
    Cancelled,   // when creator cancelled the raffle
    SuccessEnded, // raffle winners are announced successfully, when raffle met the end time
    FailedEnded, // rafle is ended(met the end time), but no tickets are solded
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum PrizeType {
    Nft,
    Spl,
    Sol,
}
