use anchor_lang::prelude::*;

#[account] // seed = "gumball"
#[derive(InitSpace)]
pub struct GumballConfig {
    pub gumball_owner: Pubkey,
    pub gumball_admin: Pubkey,
    pub creation_fee_lamports: u64, // while creating the gumball the user have to pay fees Native SOL
    pub ticket_fee_bps: u16, // 100 = 1%, for every sale of ticket this % of fees is sent to owner + stakers
    pub minimum_gumball_period: u32, // minimum period the gumball should be active
    pub maximum_gumball_period: u32, // maximum peroid the gumball can be set
    pub gumball_count: u32,  // use the latest gumball count for seed, start from `1`
    pub pause_flags: u8,     // pause the function using bit masking
    pub config_bump: u8,
}

#[account] // seed = "gumball" + `gumball_id`
#[derive(InitSpace)]
pub struct GumballMachine {
    pub gumball_id: u32,
    pub creator: Pubkey,
    pub start_time: i64,
    pub end_time: i64,
    pub total_tickets: u16,          // prizes should be <= total tickets
    pub tickets_sold: u16, // if the tickets_sold > prizes_added that means all added prizes are completed, so there are no prizes in gumball
    pub prizes_added: u16, // increases every time, when creator adds the prizes
    pub ticket_mint: Option<Pubkey>, // user have to play with this ticket mint, (if None then pay with SOL)
    pub ticket_price: u64,
    pub status: GumballState,
    pub gumball_bump: u8,
}

#[account] // seeds = "gumball" + `gumball_id` + `prize_index`
#[derive(InitSpace)]
pub struct Prize {
    pub gumball_id: u32,
    pub prize_index: u16, // if the index is already created an account then check the mint and prize amount
    pub if_prize_nft: bool,
    pub mint: Pubkey,
    pub total_amount: u64, // quantity * prize amount
    pub prize_amount: u64, // SPL amount per unit (for NFTs = 1)
    pub quantity: u16,
}

#[derive(InitSpace, AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum GumballState {
    None,
    Initialized,
    Active,
    Cancelled, // when creator cancel the gumball
    CompletedSuccessfully,
    CompletedFailed,
}
