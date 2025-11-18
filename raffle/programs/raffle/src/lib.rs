use anchor_lang::prelude::*;

declare_id!("2MPhsZEKi3aCFZmtgSw4DTFnRm26WiRdHo9U8GYHGFRR");

#[program]
pub mod raffle {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
