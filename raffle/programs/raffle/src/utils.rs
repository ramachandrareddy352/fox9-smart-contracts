use crate::constants::TOTAL_PCT;
use crate::errors::RaffleStateErrors;
use anchor_lang::prelude::*;

/// Check if any duplicate Pubkeys exist
pub fn has_duplicate_pubkeys(list: &[Pubkey]) -> bool {
    for i in 0..list.len() {
        for j in (i + 1)..list.len() {
            if list[i] == list[j] {
                return true;
            }
        }
    }
    false
}

/// Calculate the maximum number of tickets a wallet can buy
pub fn calculate_max_tickets(
    total_tickets: u16,
    max_per_wallet_pct: u8,
) -> Result<u16> {
    let total = total_tickets as u32;
    let pct = max_per_wallet_pct as u32;

    let product = total
        .checked_mul(pct)
        .ok_or(RaffleStateErrors::Overflow)?;

    // Round up: (value + base - 1) / base
    let max_tickets = ((product + (TOTAL_PCT as u32 - 1)) / TOTAL_PCT as u32) as u16;

    Ok(max_tickets.max(1))
}

/// Calculate percentage-based amount safely: (amount * pct) / base
pub fn get_pct_amount(amount: u64, pct: u64, base: u64) -> Result<u64> {
    let mul = amount
        .checked_mul(pct)
        .ok_or(RaffleStateErrors::Overflow)?;

    let div = mul
        .checked_div(base)
        .ok_or(RaffleStateErrors::Overflow)?;

    Ok(div)
}

// weather the fucntion is paused or not
pub fn is_paused(pause_flags: u8, index: u8) -> bool {
    let mask = 1u8 << index;   // set the bit at `index`
    (pause_flags & mask) != 0  // check if it's active
}

/// Validate win share list: 
/// - non-empty
/// - max 10 shares
/// - each share between 1 and 100
/// - non-increasing
/// - total == 100
pub fn validate_win_shares(win_shares: &[u8]) -> bool {
    if win_shares.is_empty() || win_shares.len() > 10 {
        return false;
    }

    let mut total: u16 = 0;

    for (i, &share) in win_shares.iter().enumerate() {
        if share == 0 || share > TOTAL_PCT {
            return false;
        }

        // must be non-increasing
        if i > 0 && share > win_shares[i - 1] {
            return false;
        }

        total = total.checked_add(share as u16).unwrap_or(u16::MAX);
    }

    total == TOTAL_PCT as u16
}
