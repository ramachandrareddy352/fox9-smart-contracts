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
    if max_per_wallet_pct == 0 {
        return Err(RaffleErrors::InvalidMaxPerWalletPct); // Should not occur due to validation
    }

    let total = total_tickets as u32;
    let pct = max_per_wallet_pct as u32;
    let product = total.checked_mul(pct).ok_or(RaffleErrors::Overflow)?;
    let numerator = product
        .checked_add(99) // Ceiling division: ceil(product / 100)
        .ok_or(RaffleErrors::Overflow)?;
    let max_tickets = ((numerator / 100) as u16).max(1); // Ensure at least 1

    Ok(max_tickets)
}

pub fn get_pct_amount<'info>(amount: u64, fees: u64, base: u64) -> Result<(u64)> {}

pub const fn raffle_dynamic_space() -> usize {
    // winners + is_win_claimed storage
    (100 * 32) + (100)
}

pub fn is_descending_order_and_sum_100(win_shares: &[u8]) -> bool {
    // Must have at least 1 share and sum must be 100
    let total: u8 = win_shares.iter().map(|&s| s).sum();
    if total != TOTAL_PCT {
        return false;
    }

    // If single value and sum was 100, it's valid
    if win_shares.len() <= 1 {
        return true;
    }

    // Check descending order (allow equal values)
    for i in 1..win_shares.len() {
        if win_shares[i] > win_shares[i - 1] {
            return false;
        }
    }

    true
}
