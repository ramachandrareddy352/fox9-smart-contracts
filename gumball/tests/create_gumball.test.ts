import assert from "assert";
import * as anchor from "@coral-xyz/anchor";
import { startAnchor, Clock } from "solana-bankrun";
import { BankrunProvider } from "anchor-bankrun";
import {
    createSplMint,
    createAta,
    initializeGumballConfig,
    createGumball,
    getSolBalance,
    mintTokens,
    buildCreateGumballAccounts,
    getTokenBalance,
    getCurrentTimestamp,
    withdrawSolFees,
    activateGumball,
    warpForward,
    cancelGumball,
    updateGumballTime,
    updateGumballData,
    endGumball,
} from "./helpers";
import {
    setProgram,
    setProvider,
    gumball_owner,
    gumball_admin,
    gumball_1_creator,
    gumball_2_creator,
    gumballConfigPda,
    gumballPda,
    creation_fee_lamports,
    ticket_fee_bps,
    minimum_Gumball_period,
    maximum_Gumball_period,
} from "./values";
import { Gumball } from "../target/types/gumball";

describe("Create Gumball — Bankrun", () => {
    let context: any;
    let provider: BankrunProvider;
    let program: anchor.Program<Gumball>;

    before(async () => {
        context = await startAnchor("", [], []);
        provider = new BankrunProvider(context);
        anchor.setProvider(provider);
        setProvider(provider);

        program = anchor.workspace.Gumball as anchor.Program<Gumball>;
        setProgram(program);

        // FUND KEYPAIRS
        const fund = async (kp) =>
            context.setAccount(kp.publicKey, {
                lamports: 50_000_000_000,
                owner: anchor.web3.SystemProgram.programId,
                data: Buffer.alloc(0),
                executable: false,
            });

        await fund(gumball_owner);
        await fund(gumball_1_creator);
        await fund(gumball_2_creator);

        await initializeGumballConfig(
            gumball_owner,
            gumball_owner.publicKey,
            gumball_admin.publicKey,
            creation_fee_lamports,
            ticket_fee_bps,
            minimum_Gumball_period,
            maximum_Gumball_period
        );
    });

    async function nextGumballIdAndPda() {
        const cfg = await program.account.gumballConfig.fetch(gumballConfigPda());
        const id = cfg.gumballCount;
        const pda = gumballPda(id);
        return { id, pda };
    }

    it("owner successfully withdraws SOL fees after gumball creation", async () => {
        // -------- Setup SPL mint even though ticket_sol = true ------
        const ticketMint = await createSplMint(9);
        const { id: gumballId, pda: gumballPdaAddr } = await nextGumballIdAndPda();

        const { ticketEscrow, prizeEscrow, creatorPrizeAta } =
            await buildCreateGumballAccounts(
                gumballPdaAddr,
                gumball_1_creator,
                ticketMint,
                ticketMint
            );

        // ---------- Create gumball (fee will be collected) ----------
        const client = context.banksClient;
        const nowClock = await client.getClock();
        const now = Number(nowClock.unixTimestamp);
        const start = now + 200;
        const end = start + minimum_Gumball_period + 100;

        await createGumball(
            {
                startTime: start,
                endTime: end,
                totalTickets: 10,
                ticketPrice: 1_000_000_000,
                isTicketSol: true,
                startGumball: false,
            },
            {
                gumballPda: gumballPdaAddr,
                creator: gumball_1_creator,
                gumballAdmin: gumball_admin,
                ticketMint,
            }
        );

        const afterCreateConfigBal = await getSolBalance(gumballConfigPda());
        console.log("\nConfig after create (should include fee):", afterCreateConfigBal);

        // -------- Now OWNER withdraws fees into receiver wallet --------
        const withdrawAmount: number = creation_fee_lamports;

        // PRE-BALANCES
        const beforeConfigBalance = await getSolBalance(gumballConfigPda());
        const beforeOwnerBalance = await getSolBalance(gumball_owner.publicKey);
        const beforeReceiverBalance = await getSolBalance(gumball_2_creator.publicKey);

        console.log("\n==== BEFORE WITHDRAW ====");
        console.log("Config SOL:", beforeConfigBalance);
        console.log("Owner SOL :", beforeOwnerBalance);
        console.log("Receiver SOL:", beforeReceiverBalance);

        await withdrawSolFees(
            gumball_owner,            // must match gumball_owner from config
            gumball_2_creator.publicKey, // receiver
            withdrawAmount
        );

        // -------- POST-WITHDRAW BALANCES --------
        const finalConfigBalance = await getSolBalance(gumballConfigPda());
        const finalOwnerBalance = await getSolBalance(gumball_owner.publicKey);
        const finalReceiverBalance = await getSolBalance(gumball_2_creator.publicKey);

        console.log("\n==== AFTER WITHDRAW ====");
        console.log("Config SOL:", finalConfigBalance);
        console.log("Owner SOL :", finalOwnerBalance);
        console.log("Receiver SOL:", finalReceiverBalance);

        // reject when the start time is not reached
        await assert.rejects(
            activateGumball(gumballPdaAddr, gumballId, gumball_admin)
        );

        // wrap some time to test cases
        await warpForward(1000);
        await activateGumball(gumballPdaAddr, gumballId, gumball_admin);

        await updateGumballData(gumballPdaAddr, gumballId, 200_000_000, 3, gumball_1_creator, gumball_admin);

        await warpForward(10000);

        // await updateGumballTime(gumballPdaAddr, gumballId, now + 100000, end, true, gumball_1_creator, gumball_admin);

        const fakeMint = await createSplMint();

        // we are using sol, so fake mint and ata are accepted
        await endGumball(gumballPdaAddr, gumballId, gumball_admin, gumball_1_creator, fakeMint, ticketEscrow, ticketEscrow, ticketEscrow);

        const solGumball = await program.account.gumballMachine.fetch(gumballPdaAddr);
        console.log(solGumball)

        // await cancelGumball(gumballPdaAddr, gumballId, gumball_1_creator, gumball_admin);

    });

    // it("creates a valid SPL-ticket Gumball and logs balances neatly", async () => {
    //     const ticketMint = await createSplMint(9);
    //     const { id: gumballId, pda: gumballPdaAddr } = await nextGumballIdAndPda();

    //     const { ticketEscrow, prizeEscrow, creatorPrizeAta } =
    //         await buildCreateGumballAccounts(
    //             gumballPdaAddr,
    //             gumball_1_creator,
    //             ticketMint,
    //             ticketMint
    //         );

    //     await mintTokens(ticketMint, creatorPrizeAta, 100_000_000_000);

    //     const beforeConfigBalance = await getSolBalance(gumballConfigPda());
    //     const beforeCreatorBalance = await getSolBalance(gumball_1_creator.publicKey);

    //     console.log("\n==============================");
    //     console.log(" BEFORE CREATE-GUMBALL (SPL)");
    //     console.log("==============================");
    //     console.log("Config SOL Balance:       ", beforeConfigBalance);
    //     console.log("Creator SOL Balance:      ", beforeCreatorBalance);
    //     console.log("Creator Ticket ATA Amount:", await getTokenBalance(creatorPrizeAta));
    //     console.log("==============================\n");

    //     const client = context.banksClient;
    //     const nowClock = await client.getClock();
    //     const now = Number(nowClock.unixTimestamp);
    //     const end = now + minimum_Gumball_period + 100;

    //     await createGumball(
    //         {
    //             startTime: now + 999999,
    //             endTime: end,
    //             totalTickets: 20,
    //             ticketPrice: 500_000_000,
    //             isTicketSol: false,
    //             startGumball: true,
    //         },
    //         {
    //             gumballPda: gumballPdaAddr,
    //             creator: gumball_1_creator,
    //             gumballAdmin: gumball_admin,
    //             ticketMint,
    //         }
    //     );

    //     const created = await program.account.gumballMachine.fetch(gumballPdaAddr);

    //     const afterConfigBalance = await getSolBalance(gumballConfigPda());
    //     const afterCreatorBalance = await getSolBalance(gumball_1_creator.publicKey);

    //     console.log("\n==============================");
    //     console.log(" AFTER CREATE-GUMBALL (SPL)");
    //     console.log("==============================");
    //     console.log("Config SOL Balance:       ", afterConfigBalance);
    //     console.log("Creator SOL Balance:      ", afterCreatorBalance);
    //     console.log("--------------------------------");
    //     console.log("CONFIG CHANGE (+):        ", afterConfigBalance - beforeConfigBalance);
    //     console.log("CREATOR CHANGE (-):       ", beforeCreatorBalance - afterCreatorBalance);
    //     console.log("==============================\n");

    //     assert.equal(created.gumballId, gumballId);
    //     assert.equal(created.ticketMint.toString(), ticketMint.toString());
    //     assert.deepEqual(created.status, { active: {} });
    // });

    // it("fails when ticket_price == 0", async () => {
    //     const ticketMint = await createSplMint(9);
    //     const { id: gumballId, pda: gumballPdaAddr } = await nextGumballIdAndPda();

    //     const { ticketEscrow, prizeEscrow, creatorPrizeAta } =
    //         await buildCreateGumballAccounts(gumballPdaAddr, gumball_1_creator, ticketMint, ticketMint);

    //     const client = context.banksClient;
    //     const nowClock = await client.getClock();
    //     const now = Number(nowClock.unixTimestamp);
    //     const start = now + 100;
    //     const end = start + minimum_Gumball_period + 100;

    //     await assert.rejects(
    //         createGumball(
    //             {
    //                 startTime: start,
    //                 endTime: end,
    //                 totalTickets: 5,
    //                 ticketPrice: 0, // invalid
    //                 isTicketSol: false,
    //                 startGumball: false,
    //             },
    //             {
    //                 gumballPda: gumballPdaAddr,
    //                 creator: gumball_1_creator,
    //                 gumballAdmin: gumball_admin,
    //                 ticketMint,
    //             }
    //         )
    //     );
    // });

    // it("fails when total_tickets < MINIMUM_TICKETS", async () => {
    //     const ticketMint = await createSplMint(9);
    //     const { id: gumballId, pda: gumballPdaAddr } = await nextGumballIdAndPda();
    //     const { ticketEscrow, prizeEscrow, creatorPrizeAta } =
    //         await buildCreateGumballAccounts(gumballPdaAddr, gumball_1_creator, ticketMint, ticketMint);

    //     const client = context.banksClient;
    //     const nowClock = await client.getClock();
    //     const now = Number(nowClock.unixTimestamp);
    //     const start = now + 50;
    //     const end = start + minimum_Gumball_period + 10;

    //     await assert.rejects(
    //         createGumball(
    //             {
    //                 startTime: start,
    //                 endTime: end,
    //                 totalTickets: 1, // < MINIMUM_TICKETS
    //                 ticketPrice: 1000,
    //                 isTicketSol: false,
    //                 startGumball: false,
    //             },
    //             {
    //                 gumballPda: gumballPdaAddr,
    //                 creator: gumball_1_creator,
    //                 gumballAdmin: gumball_admin,
    //                 ticketMint,
    //             }
    //         )
    //     );
    // });

    // it("fails when total_tickets > MAXIMUM_TICKETS", async () => {
    //     // MAXIMUM_TICKETS is 1000 per your constants
    //     const ticketMint = await createSplMint(9);
    //     const { id: gumballId, pda: gumballPdaAddr } = await nextGumballIdAndPda();
    //     const { ticketEscrow, prizeEscrow, creatorPrizeAta } =
    //         await buildCreateGumballAccounts(gumballPdaAddr, gumball_1_creator, ticketMint, ticketMint);

    //     const now = await getCurrentTimestamp();
    //     const start = now + 100;
    //     const end = start + minimum_Gumball_period + 10;

    //     await assert.rejects(
    //         createGumball(
    //             {
    //                 startTime: start,
    //                 endTime: end,
    //                 totalTickets: 2000, // > MAXIMUM_TICKETS
    //                 ticketPrice: 1000,
    //                 isTicketSol: false,
    //                 startGumball: false,
    //             },
    //             {
    //                 gumballPda: gumballPdaAddr,
    //                 creator: gumball_1_creator,
    //                 gumballAdmin: gumball_admin,
    //                 ticketMint,
    //             }
    //         )
    //     );
    // });

    // it("fails when start_time is in the past (unless startGumball=true)", async () => {
    //     const ticketMint = await createSplMint(9);
    //     const { id: gumballId, pda: gumballPdaAddr } = await nextGumballIdAndPda();
    //     const { ticketEscrow, prizeEscrow, creatorPrizeAta } =
    //         await buildCreateGumballAccounts(gumballPdaAddr, gumball_1_creator, ticketMint, ticketMint);

    //     const client = context.banksClient;
    //     const nowClock = await client.getClock();
    //     const now = Number(nowClock.unixTimestamp);

    //     // attempt start in the past
    //     const badStart = now - 1000;
    //     const end = now + minimum_Gumball_period + 100;

    //     await assert.rejects(
    //         createGumball(
    //             {
    //                 startTime: badStart,
    //                 endTime: end,
    //                 totalTickets: 10,
    //                 ticketPrice: 2000,
    //                 isTicketSol: false,
    //                 startGumball: false, // not allowed, start_time in past
    //             },
    //             {
    //                 gumballPda: gumballPdaAddr,
    //                 creator: gumball_1_creator,
    //                 gumballAdmin: gumball_admin,
    //                 ticketMint,
    //             }
    //         )
    //     );

    //     // but allowed when startGumball=true (program sets start_time = now)
    //     const { id: id2, pda: pda2 } = await nextGumballIdAndPda();
    //     const { ticketEscrow: t2, prizeEscrow: p2, creatorPrizeAta: c2 } =
    //         await buildCreateGumballAccounts(pda2, gumball_1_creator, ticketMint, ticketMint);

    //     const end2 = now + minimum_Gumball_period + 100;
    //     await createGumball(
    //         {
    //             startTime: badStart,
    //             endTime: end2,
    //             totalTickets: 10,
    //             ticketPrice: 2000,
    //             isTicketSol: false,
    //             startGumball: true, // program will override start_time with now
    //         },
    //         {
    //             gumballPda: pda2,
    //             creator: gumball_1_creator,
    //             gumballAdmin: gumball_admin,
    //             ticketMint,
    //         }
    //     );

    //     const created2 = await program.account.gumballMachine.fetch(pda2);
    //     // start_time must equal approx now (clock from bankrun)
    //     const nowClock2 = await client.getClock();
    //     assert.ok(Math.abs(created2.startTime.toNumber() - Number(nowClock2.unixTimestamp)) < 5);
    // });

    //   it("fails when duration < minimum_gumball_period or > maximum_gumball_period", async () => {
    //     const ticketMint = await createSplMint(9);
    //     const { id: gumballId, pda: gumballPdaAddr } = await nextGumballIdAndPda();
    //     const { ticketEscrow, prizeEscrow, creatorPrizeAta } =
    //       await buildCreateGumballAccounts(gumballPdaAddr, gumball_1_creator, ticketMint, ticketMint);

    //     const client = context.banksClient;
    //     const nowClock = await client.getClock();
    //     const now = Number(nowClock.unixTimestamp);

    //     // too short
    //     await assert.rejects(
    //       createGumball(
    //         {
    //           startTime: now + 10,
    //           endTime: now + 10 + minimum_Gumball_period - 1, // less than minimum
    //           totalTickets: 10,
    //           ticketPrice: 1000,
    //           isTicketSol: false,
    //           startGumball: false,
    //         },
    //         {
    //           gumballPda: gumballPdaAddr,
    //           creator: gumball_1_creator,
    //           gumballAdmin: gumball_admin,
    //           ticketMint,
    //         }
    //       )
    //     );

    //     // too long
    //     const { id: g2, pda: pda2 } = await nextGumballIdAndPda();
    //     const { ticketEscrow: te2, prizeEscrow: pe2, creatorPrizeAta: ca2 } =
    //       await buildCreateGumballAccounts(pda2, gumball_1_creator, ticketMint, ticketMint);

    //     await assert.rejects(
    //       createGumball(
    //         {
    //           startTime: now + 10,
    //           endTime: now + 10 + maximum_Gumball_period + 100, // greater than maximum
    //           totalTickets: 10,
    //           ticketPrice: 1000,
    //           isTicketSol: false,
    //           startGumball: false,
    //         },
    //         {
    //           gumballPda: pda2,
    //           creator: gumball_1_creator,
    //           gumballAdmin: gumball_admin,
    //           ticketMint,
    //         }
    //       )
    //     );
    //   });

    // it("fails when wrong gumball_admin is supplied (constraint)", async () => {
    //     const ticketMint = await createSplMint(9);
    //     const { id: gumballId, pda: gumballPdaAddr } = await nextGumballIdAndPda();
    //     const { ticketEscrow, prizeEscrow, creatorPrizeAta } =
    //         await buildCreateGumballAccounts(gumballPdaAddr, gumball_1_creator, ticketMint, ticketMint);

    //     const client = context.banksClient;
    //     const nowClock = await client.getClock();
    //     const now = Number(nowClock.unixTimestamp);
    //     const start = now + 10;
    //     const end = start + minimum_Gumball_period + 100;

    //     // Try to call createGumball with gumballAdmin = gumball_2_creator (does not match config.gumball_admin)
    //     await assert.rejects(
    //         createGumball(
    //             {
    //                 startTime: start,
    //                 endTime: end,
    //                 totalTickets: 10,
    //                 ticketPrice: 1000,
    //                 isTicketSol: false,
    //                 startGumball: false,
    //             },
    //             {
    //                 gumballPda: gumballPdaAddr,
    //                 creator: gumball_1_creator,
    //                 gumballAdmin: gumball_2_creator, // wrong admin
    //                 ticketMint,
    //             }
    //         )
    //     );
    // });

    //   it("fails when CREATE_GUMBALL_PAUSE bit is set on config", async () => {
    //     // Deposit a config record and then mutate pause_flags by writing directly via bankrun context
    //     const cfg = await program.account.gumballConfig.fetch(gumballConfigPda());
    //     // toggle pause bit for CREATE_GUMBALL_PAUSE (index 0)
    //     const modified = { ...cfg, pauseFlags: cfg.pauseFlags | (1 << 0) };
    //     // encode and override account
    //     await context.setAccount(gumballConfigPda(), {
    //       lamports: BigInt(await getSolBalance(gumballConfigPda())),
    //       owner: program.programId,
    //       executable: false,
    //       data: program.coder.accounts.encode("gumballConfig", modified),
    //     });

    //     const ticketMint = await createSplMint(9);
    //     const { id: gumballId, pda: gumballPdaAddr } = await nextGumballIdAndPda();
    //     const { ticketEscrow, prizeEscrow, creatorPrizeAta } =
    //       await buildCreateGumballAccounts(gumballPdaAddr, gumball_1_creator, ticketMint, ticketMint);

    //     const client = context.banksClient;
    //     const nowClock = await client.getClock();
    //     const now = Number(nowClock.unixTimestamp);
    //     const start = now + 10;
    //     const end = start + minimum_Gumball_period + 100;

    //     await assert.rejects(
    //       createGumball(
    //         {
    //           startTime: start,
    //           endTime: end,
    //           totalTickets: 10,
    //           ticketPrice: 1000,
    //           isTicketSol: false,
    //           startGumball: false,
    //         },
    //         {
    //           gumballPda: gumballPdaAddr,
    //           creator: gumball_1_creator,
    //           gumballAdmin: gumball_admin,
    //           ticketMint,
    //         }
    //       )
    //     );

    //     // restore pause flags (clear bit 0)
    //     const cfgRestored = { ...modified, pauseFlags: modified.pauseFlags & ~(1 << 0) };
    //     await context.setAccount(gumballConfigPda(), {
    //       lamports: BigInt(await getSolBalance(gumballConfigPda())),
    //       owner: program.programId,
    //       executable: false,
    //       data: program.coder.accounts.encode("gumballConfig", cfgRestored),
    //     });
    //   });

});
