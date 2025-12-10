import assert from "assert";
import * as anchor from "@coral-xyz/anchor";
import { startAnchor } from "solana-bankrun";
import { BankrunProvider } from "anchor-bankrun";
import * as web3 from "@solana/web3.js";
import BN from "bn.js";

import {
  creation_fee_lamports,
  ticket_fee_bps,
  minimum_raffle_period,
  maximum_raffle_period,
  raffle_owner,
  raffle_admin,
  setProgram,
  setProvider,
  getProgram,
  getProvider,
  raffleConfigPda,
} from "./values";

describe("Raffle Config – Bankrun", () => {
  let context: any;
  let provider: BankrunProvider;

  before(async () => {
    context = await startAnchor("", [], []);
    provider = new BankrunProvider(context);

    anchor.setProvider(provider);
    setProvider(provider);

    const program = anchor.workspace.Raffle as anchor.Program<any>;
    setProgram(program);

    // FUND OWNER DIRECTLY IN BANKRUN (no transfer instruction needed)
    await context.setAccount(raffle_owner.publicKey, {
      lamports: 10_000_000_000n,
      owner: web3.SystemProgram.programId,
      data: Buffer.alloc(0),
      executable: false,
    });
  });

  it("initialize raffle config and verify state", async () => {
    const program = getProgram();

    await program.methods
      .initializeRaffleConfig(
        raffle_owner.publicKey,
        raffle_admin.publicKey,
        new BN(creation_fee_lamports),
        ticket_fee_bps,
        minimum_raffle_period,
        maximum_raffle_period
      )
      .accounts({
        raffleConfig: raffleConfigPda(),
        payer: raffle_owner.publicKey,
        systemProgram: web3.SystemProgram.programId,
      })
      .signers([raffle_owner])
      .rpc();

    const account = await program.account.raffleConfig.fetch(raffleConfigPda());

    assert.equal(account.raffleOwner.toString(), raffle_owner.publicKey.toString());
    assert.equal(account.raffleAdmin.toString(), raffle_admin.publicKey.toString());
    assert.equal(account.creationFeeLamports.toNumber(), creation_fee_lamports);
    assert.equal(account.ticketFeeBps, ticket_fee_bps);
    assert.equal(account.minimumRafflePeriod, minimum_raffle_period);
    assert.equal(account.maximumRafflePeriod, maximum_raffle_period);

    // defaults
    assert.equal(account.raffleCount, 1);
    assert.equal(account.pauseFlags, 0);
    assert.ok(account.configBump >= 0);
  });

  it("updates raffle admin successfully", async () => {
    const program = getProgram();
    const new_admin = web3.Keypair.generate().publicKey;

    const beforeState = await program.account.raffleConfig.fetch(raffleConfigPda());
    const storedOwner = beforeState.raffleOwner;

    await program.methods
      .updateRaffleConfigAdmin(new_admin)
      .accounts({
        raffleConfig: raffleConfigPda(),
        raffleOwner: storedOwner,
      })
      .signers([raffle_owner])
      .rpc();

    const updated = await program.account.raffleConfig.fetch(raffleConfigPda());
    assert.equal(updated.raffleAdmin.toString(), new_admin.toString());
  });

  it("updates config data successfully", async () => {
    const program = getProgram();
    const new_min = 7200;
    const new_max = 12000;
    const new_fee = new BN(200_000_000);
    const new_bps = 200;

    const beforeState = await program.account.raffleConfig.fetch(raffleConfigPda());
    const storedOwner = beforeState.raffleOwner;

    await program.methods
      .updateRaffleConfigData(
        new_fee,
        new_bps,
        new_min,
        new_max
      )
      .accounts({
        raffleConfig: raffleConfigPda(),
        raffleOwner: storedOwner,
      })
      .signers([raffle_owner])
      .rpc();

    const updated = await program.account.raffleConfig.fetch(raffleConfigPda());

    assert.equal(updated.minimumRafflePeriod, new_min);
    assert.equal(updated.maximumRafflePeriod, new_max);
    assert.equal(updated.ticketFeeBps, new_bps);
    assert.equal(updated.creationFeeLamports.toNumber(), new_fee.toNumber());
  });

  it("updates pause flags", async () => {
    const program = getProgram();
    const new_flags = 5;

    const beforeState = await program.account.raffleConfig.fetch(raffleConfigPda());
    const storedOwner = beforeState.raffleOwner;

    await program.methods
      .updatePauseAndUnpause(new_flags)
      .accounts({
        raffleConfig: raffleConfigPda(),
        raffleOwner: storedOwner,
      })
      .signers([raffle_owner])
      .rpc();

    const updated = await program.account.raffleConfig.fetch(raffleConfigPda());
    assert.equal(updated.pauseFlags, new_flags);
  });

  it("fails when wrong owner tries to update config", async () => {
    const program = getProgram();
    const fake_owner = web3.Keypair.generate();

    await assert.rejects(
      program.methods
        .updatePauseAndUnpause(77)
        .accounts({
          raffleConfig: raffleConfigPda(),
          raffleOwner: fake_owner.publicKey,
        })
        .signers([fake_owner])
        .rpc()
    );
  });

  it("update fails if minimum period = 0", async () => {
    const program = getProgram();

    await assert.rejects(
      program.methods
        .updateRaffleConfigData(
          new BN(creation_fee_lamports),
          ticket_fee_bps,
          0,
          maximum_raffle_period
        )
        .accounts({
          raffleConfig: raffleConfigPda(),
          raffleOwner: raffle_owner.publicKey,
        })
        .signers([raffle_owner])
        .rpc()
    );
  });

  it("update fails if max period < min period", async () => {
    const program = getProgram();

    await assert.rejects(
      program.methods
        .updateRaffleConfigData(
          new BN(creation_fee_lamports),
          ticket_fee_bps,
          3600,
          1000
        )
        .accounts({
          raffleConfig: raffleConfigPda(),
          raffleOwner: raffle_owner.publicKey,
        })
        .signers([raffle_owner])
        .rpc()
    );
  });
});

describe("Invalid creation tests", () => {
  it("fails if min period = 0", async () => {
    const program = getProgram();

    await assert.rejects(
      program.methods
        .initializeRaffleConfig(
          raffle_owner.publicKey,
          raffle_admin.publicKey,
          new BN(creation_fee_lamports),
          ticket_fee_bps,
          0,
          maximum_raffle_period
        )
        .accounts({
          raffleConfig: raffleConfigPda(),
          payer: raffle_owner.publicKey,
          systemProgram: web3.SystemProgram.programId,
        })
        .signers([raffle_owner])
        .rpc()
    );
  });

  it("fails if max < min", async () => {
    const program = getProgram();

    await assert.rejects(
      program.methods
        .initializeRaffleConfig(
          raffle_owner.publicKey,
          raffle_admin.publicKey,
          new BN(creation_fee_lamports),
          ticket_fee_bps,
          minimum_raffle_period,
          1000
        )
        .accounts({
          raffleConfig: raffleConfigPda(),
          payer: raffle_owner.publicKey,
          systemProgram: web3.SystemProgram.programId,
        })
        .signers([raffle_owner])
        .rpc()
    );
  });
});
