use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;
use crate::errors::AuctionStateErrors;

pub fn get_pct_amount(amount: u64, pct: u64, base: u64) -> Result<u64> {
    let mul = amount
        .checked_mul(pct)
        .ok_or(AuctionStateErrors::Overflow)?;
    let div = mul.checked_div(base).ok_or(AuctionStateErrors::Overflow)?;
    Ok(div)
}

pub fn validate_nft(mint: &InterfaceAccount<Mint>) -> Result<()> {
    require!(
        mint.decimals == 0 && mint.supply == 1,
        AuctionStateErrors::InvalidNFT
    );
    Ok(())
}

// weather the fucntion is paused or not
pub fn is_paused(pause_flags: u8, index: u8) -> bool {
    let mask = 1u8 << index; // set the bit at `index`
    (pause_flags & mask) != 0 // check if it's active
}
