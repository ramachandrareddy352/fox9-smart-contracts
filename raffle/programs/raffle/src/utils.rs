use crate::constants::*;
use crate::errors::RaffleErrors;
use anchor_lang::prelude::*;

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

pub fn calculate_max_tickets(
    total_tickets: u16,
    max_per_wallet_pct: u8,
) -> Result<u16, RaffleErrors> {
    let total = total_tickets as u32;
    let pct = max_per_wallet_pct as u32;
    let product = total.checked_mul(pct).ok_or(RaffleErrors::Overflow)?;
    let numerator = product
        .checked_add(99) // Ceiling division: ceil(product / 100)
        .ok_or(RaffleErrors::Overflow)?;
    let max_tickets = ((numerator / TOTAL_PCT) as u16).max(1); // Ensure at least 1

    Ok(max_tickets)
}

pub fn get_pct_amount(amount: u64, fees: u64, base: u64) -> Result<u64, RaffleErrors> {
    let product = amount.checked_mul(fees).ok_or(RaffleErrors::Overflow)?;
    product.checked_div(base).ok_or(RaffleErrors::Overflow)
}

pub fn validate_win_shares(win_shares: &[u8]) -> bool {
    let mut total: u16 = 0;
    for i in 0..win_shares.len() {
        let s = win_shares[i];
        if s == 0 || s > 100 {
            return false;
        }
        if i > 0 && s > win_shares[i - 1] {
            return false;
        } // non-increasing
        total = total.checked_add(s as u16).unwrap_or(u16::MAX);
    }
    total == TOTAL_PCT as u16
}
