import BN from "bn.js";
import * as web3 from "@solana/web3.js";
import assert from "assert";
import { createRaffleConfig, transferSol } from './helpers';
import * as values from './values';

describe("Test with valid creation", () => {
  before(async () => {
    await transferSol(values.provider.wallet.payer, values.raffle_owner.publicKey, 1_000_000_000)
  });

  it("initialize raffle config and verify state", async () => {

    await createRaffleConfig(
      values.program,
      values.raffleConfigPda(),
      values.raffle_owner,
      values.raffle_admin.publicKey,
      {
        creationFeeLamports: values.creation_fee_lamports,
        ticketFeeBps: values.ticket_fee_bps,
        minPeriod: values.minimum_raffle_period,
        maxPeriod: values.maximum_raffle_period
      }
    );

    // FETCH ACCOUNT STATE AFTER INITIALIZATION
    const account = await values.program.account.raffleConfig.fetch(values.raffleConfigPda());

    // ASSERT ALL STORED VALUES ARE CORRECT
    assert.equal(account.raffleOwner.toString(), values.raffle_owner.publicKey.toString());
    assert.equal(account.raffleAdmin.toString(), values.raffle_admin.publicKey.toString());
    assert.equal(account.creationFeeLamports.toNumber(), values.creation_fee_lamports);
    assert.equal(account.ticketFeeBps, values.ticket_fee_bps);
    assert.equal(account.minimumRafflePeriod, values.minimum_raffle_period);
    assert.equal(account.maximumRafflePeriod, values.maximum_raffle_period);

    // Additional defaults:
    assert.equal(account.raffleCount, 1);     // first config
    assert.equal(account.pauseFlags, 0);      // by default
    assert.ok(account.configBump >= 0);       // bump must exist

  });

  it("updates raffle admin successfully", async () => {
    const new_admin = web3.Keypair.generate().publicKey;

    // Owner is now the "new_owner" from previous test
    const account_before = await values.program.account.raffleConfig.fetch(values.raffleConfigPda());
    const current_owner = account_before.raffleOwner;

    await values.program.methods
      .updateRaffleConfigAdmin(new_admin)
      .accounts({
        raffleConfig: values.raffleConfigPda(),
        raffleOwner: current_owner, // correct owner signer
      })
      .signers([values.raffle_owner]) // original_wallet still signs (still has keypair)
      .rpc();

    const updated = await values.program.account.raffleConfig.fetch(values.raffleConfigPda());

    assert.equal(updated.raffleAdmin.toString(), new_admin.toString());
  });

  it("updates config data successfully", async () => {
    const new_min = 7200;
    const new_max = 12000;
    const new_fee = new BN(200_000_000);
    const new_bps = 200;

    const account_before = await values.program.account.raffleConfig.fetch(values.raffleConfigPda());
    const current_owner = account_before.raffleOwner;

    await values.program.methods
      .updateRaffleConfigData(
        new_fee,
        new_bps,
        new_min,
        new_max
      )
      .accounts({
        raffleConfig: values.raffleConfigPda(),
        raffleOwner: current_owner,
      })
      .signers([values.raffle_owner])
      .rpc();

    const account_after = await values.program.account.raffleConfig.fetch(values.raffleConfigPda());

    assert.equal(account_after.minimumRafflePeriod, new_min);
    assert.equal(account_after.maximumRafflePeriod, new_max);
    assert.equal(account_after.ticketFeeBps, new_bps);
    assert.equal(account_after.creationFeeLamports.toNumber(), new_fee.toNumber());
  });

  it("updates pause flags", async () => {
    const account_before = await values.program.account.raffleConfig.fetch(values.raffleConfigPda());
    const current_owner = account_before.raffleOwner;

    const new_flags = 5;

    await values.program.methods
      .updatePauseAndUnpause(new_flags)
      .accounts({
        raffleConfig: values.raffleConfigPda(),
        raffleOwner: current_owner,
      })
      .signers([values.raffle_owner])
      .rpc();

    const account_after = await values.program.account.raffleConfig.fetch(values.raffleConfigPda());

    assert.equal(account_after.pauseFlags, new_flags);
  });

  it("fails when wrong owner tries to update config", async () => {
    const fake_owner = web3.Keypair.generate();

    await assert.rejects(
      values.program.methods
        .updatePauseAndUnpause(77)
        .accounts({
          raffleConfig: values.raffleConfigPda(),
          raffleOwner: fake_owner.publicKey, // ❌ does NOT match stored owner
        })
        .signers([fake_owner])
        .rpc()
    );
  });

  it("update fails if minimum period = 0", async () => {
    await assert.rejects(
      values.program.methods
        .updateRaffleConfigData(
          values.creation_fee_lamports,
          values.ticket_fee_bps,
          0,               // ❌ INVALID
          values.maximum_raffle_period
        )
        .accounts({
          raffleConfig: values.raffleConfigPda(),
          raffleOwner: values.raffle_owner.publicKey,
        })
        .signers([values.raffle_owner])
        .rpc()
    );
  });

  it("update fails if max period < min period", async () => {
    await assert.rejects(
      values.program.methods
        .updateRaffleConfigData(
          values.creation_fee_lamports,
          values.ticket_fee_bps,
          3600,     // min
          1000      // ❌ max < min
        )
        .accounts({
          raffleConfig: values.raffleConfigPda(),
          raffleOwner: values.raffle_owner.publicKey,
        })
        .signers([values.raffle_owner])
        .rpc()
    );
  });

});

describe("Test with Invalid creation data", () => {

  it("fails if minimum raffle period = 0", async () => {

    await assert.rejects(values.program.methods
      .initializeRaffleConfig(
        values.raffle_owner.publicKey,
        values.raffle_admin.publicKey,
        new BN(values.creation_fee_lamports),
        values.ticket_fee_bps,
        0,                     // ❌ INVALID: min period = 0
        values.maximum_raffle_period
      )
      .accounts({
        raffleConfig: values.raffleConfigPda(),
        payer: values.raffle_owner.publicKey,
        systemProgram: web3.SystemProgram.programId,
      })
      .signers([values.raffle_owner])
      .rpc()
    );
  });

  it("fails if maximum period is less than minimum period", async () => {

    await assert.rejects(values.program.methods
      .initializeRaffleConfig(
        values.raffle_owner.publicKey,
        values.raffle_admin.publicKey,
        new BN(values.creation_fee_lamports),
        values.ticket_fee_bps,
        values.minimum_raffle_period,           // min = 1 hour
        1000            // ❌ max < min → invalid
      )
      .accounts({
        raffleConfig: values.raffleConfigPda(),
        payer: values.raffle_owner.publicKey,
        systemProgram: web3.SystemProgram.programId,
      })
      .signers([values.raffle_owner])
      .rpc()
    );
  });
})