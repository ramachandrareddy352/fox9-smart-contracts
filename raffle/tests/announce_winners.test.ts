import assert from "assert";
import * as anchor from "@coral-xyz/anchor";
import { startAnchor } from "solana-bankrun";
import { BankrunProvider } from "anchor-bankrun";
import { Keypair, PublicKey } from "@solana/web3.js";

import {
    createRaffleConfig,
    createSplMint,
    createRaffle,
    buildCreateRaffleAccounts,
    mintTokens,
    createAta,
    getCurrentTimestamp,
    getTokenBalance,
    getSolBalance,
    announceWinners,
    buyTickets,
    warpForward,
    buyerClaimPrize,
} from "./helpers";

import {
    raffle_owner,
    raffle_admin,
    raffle_1_creator,
    setProgram,
    setProvider,
    raffleConfigPda,
    rafflePda,
    minimum_raffle_period,
    maximum_raffle_period,
    creation_fee_lamports,
    ticket_fee_bps,
} from "./values";

describe("Announce Winners – setup", () => {
    let context: any;
    let provider: BankrunProvider;
    let program: anchor.Program<any>;

    type RaffleSetup = {
        raffleId: number;
        rafflePda: PublicKey;
        ticketMint: PublicKey;
        prizeMint: PublicKey;
        ticketEscrow: PublicKey;
        prizeEscrow: PublicKey;
        creatorPrizeAta: PublicKey;
        ticketFeeTreasury: PublicKey;
    };

    let solRaffle: RaffleSetup;
    let splRaffle: RaffleSetup;

    before(async () => {
        // --- Bankrun / Anchor wiring ---
        context = await startAnchor("", [], []);
        provider = new BankrunProvider(context);
        anchor.setProvider(provider);
        setProvider(provider);

        program = anchor.workspace.Raffle as anchor.Program<any>;
        setProgram(program);

        // FUND main signers
        for (const kp of [raffle_owner, raffle_1_creator]) {
            await context.setAccount(kp.publicKey, {
                lamports: 20_000_000_000,
                owner: anchor.web3.SystemProgram.programId,
                executable: false,
                data: Buffer.alloc(0),
            });
        }

        // --- Global config ---
        await createRaffleConfig(program, raffle_owner, raffle_admin.publicKey, {
            creationFeeLamports: creation_fee_lamports,
            ticketFeeBps: ticket_fee_bps,
            minPeriod: minimum_raffle_period,
            maxPeriod: maximum_raffle_period,
        });

        // ---------------------------------------------------------------------
        // Raffle #1: SOL ticket & SOL prize
        //  - We still pass dummy SPL mints to satisfy accounts, but logic uses SOL
        //  - startTime = now, autoStart = true (immediately Active)
        // ---------------------------------------------------------------------
        solRaffle = await setupSolRaffle();

        // ---------------------------------------------------------------------
        // Raffle #2: SPL ticket & SPL prize
        //  - SPL ticket + SPL prize
        //  - startTime in now, autoStart = true (immediately activate)
        // ---------------------------------------------------------------------
        splRaffle = await setupSplRaffle();
    });

    /**
     * Setup helper: SOL ticket + SOL prize raffle
     */
    async function setupSolRaffle(): Promise<RaffleSetup> {
        const cfg = await program.account.raffleConfig.fetch(raffleConfigPda());
        const raffleId = cfg.raffleCount as number;
        const rafflePdaAddr = rafflePda(raffleId);

        // Dummy mints (required by accounts, even though logic uses SOL)
        const ticketMint = await createSplMint();
        const prizeMint = await createSplMint();

        // Build escrow + creator prize ATA for this raffle
        const { ticketEscrow, prizeEscrow, creatorPrizeAta } =
            await buildCreateRaffleAccounts(
                rafflePdaAddr,
                raffle_1_creator,
                ticketMint,
                prizeMint
            );

        // Optional: mint some prize tokens even if SOL is used in logic – harmless
        await mintTokens(prizeMint, creatorPrizeAta, 1_000_000_000);

        // Ticket fee treasury: ATA of ticketMint owned by raffleConfig PDA
        const ticketFeeTreasury = await createAta(ticketMint, raffleConfigPda());

        const now = await getCurrentTimestamp();
        const start = now;           // start immediately
        const end = now + 10000;       // short duration

        await createRaffle(
            program,
            {
                startTime: start,
                endTime: end,
                totalTickets: 100,
                ticketPrice: 100_000_000, // 0.1 SOL
                isTicketSol: true,        // SOL ticket
                maxPct: 30,
                prizeType: { sol: {} },   // SOL prize
                prizeAmount: 1_000_000_000, // 1 SOL
                numWinners: 3,
                winShares: [50, 30, 20],
                unique: true,
                autoStart: true,          // immediately Active
            },
            {
                raffleConfig: raffleConfigPda(),
                rafflePda: rafflePdaAddr,
                creator: raffle_1_creator,
                raffleAdmin: raffle_admin,
                ticketMint,
                prizeMint,
                ticketEscrow,
                prizeEscrow,
                creatorPrizeAta,
            }
        );

        return {
            raffleId,
            rafflePda: rafflePdaAddr,
            ticketMint,
            prizeMint,
            ticketEscrow,
            prizeEscrow,
            creatorPrizeAta,
            ticketFeeTreasury,
        };
    }

    /**
     * Setup helper: SPL ticket + SPL prize raffle
     */
    async function setupSplRaffle(): Promise<RaffleSetup> {
        const ticketMint = await createSplMint();
        const prizeMint = await createSplMint();

        const cfg = await program.account.raffleConfig.fetch(raffleConfigPda());
        const raffleId = cfg.raffleCount as number;
        const rafflePdaAddr = rafflePda(raffleId);

        const { ticketEscrow, prizeEscrow, creatorPrizeAta } =
            await buildCreateRaffleAccounts(
                rafflePdaAddr,
                raffle_1_creator,
                ticketMint,
                prizeMint
            );

        // Mint SPL prize to creator escrow
        await mintTokens(prizeMint, creatorPrizeAta, 1_000_000_000);

        // Ticket fee treasury: ATA of ticketMint owned by raffleConfig PDA
        const ticketFeeTreasury = await createAta(ticketMint, raffleConfigPda());

        const now = await getCurrentTimestamp();
        const start = now;     // future
        const end = now + 10000;

        await createRaffle(
            program,
            {
                startTime: start,
                endTime: end,
                totalTickets: 100,
                ticketPrice: 100_000_000, // 0.1 SPL
                isTicketSol: false,       // SPL ticket
                maxPct: 30,
                prizeType: { spl: {} },   // SPL prize
                prizeAmount: 1_000_000_000,
                numWinners: 3,
                winShares: [50, 30, 20],
                unique: false,
                autoStart: true,         // need explicit activateRaffle later
            },
            {
                raffleConfig: raffleConfigPda(),
                rafflePda: rafflePdaAddr,
                creator: raffle_1_creator,
                raffleAdmin: raffle_admin,
                ticketMint,
                prizeMint,
                ticketEscrow,
                prizeEscrow,
                creatorPrizeAta,
            }
        );

        return {
            raffleId,
            rafflePda: rafflePdaAddr,
            ticketMint,
            prizeMint,
            ticketEscrow,
            prizeEscrow,
            creatorPrizeAta,
            ticketFeeTreasury,
        };
    }

    // it("sets up exactly two raffles (SOL + SPL)", async () => {
    //     const raffleSol = await program.account.raffle.fetch(solRaffle.rafflePda);
    //     const raffleSpl = await program.account.raffle.fetch(splRaffle.rafflePda);

    //     assert.strictEqual(raffleSol.raffleId, solRaffle.raffleId);
    //     assert.strictEqual(raffleSpl.raffleId, splRaffle.raffleId);

    //     // basic type checks
    //     assert.ok(raffleSol.ticketMint === null);
    //     assert.ok(raffleSpl.ticketMint !== null);
    // });

    // it("announces winners with 4 buyers (buyer-1 buys 2 tickets, rest 1 each) and prints all balances", async () => {

    //     const raffle = splRaffle;
    //     const { raffleId, rafflePda, ticketMint, ticketEscrow, ticketFeeTreasury } = raffle;

    //     const buyers = Array.from({ length: 4 }, () => Keypair.generate());

    //     // Fund all buyers with SOL (needed for tx fees + SPL buying)
    //     for (const buyer of buyers) {
    //         await context.setAccount(buyer.publicKey, {
    //             lamports: 20_000_000_000,
    //             owner: anchor.web3.SystemProgram.programId,
    //             executable: false,
    //             data: Buffer.alloc(0),
    //         });
    //     }

    //     // --- Create ATAs & mint SPL to buyers for ticket purchase ---
    //     const buyerTicketAtas: PublicKey[] = [];
    //     for (const buyer of buyers) {
    //         const ata = await createAta(ticketMint, buyer.publicKey);
    //         buyerTicketAtas.push(ata);

    //         // Mint enough SPL tokens to buy tickets
    //         await mintTokens(ticketMint, ata, 1_000_000_000_000);
    //     }

    //     // --- BUY TICKETS ---
    //     // buyer-1 buys 2
    //     await buyTickets(
    //         program,
    //         rafflePda,
    //         raffleId,
    //         buyers[0],
    //         2,
    //         ticketMint,
    //         ticketEscrow,
    //         buyerTicketAtas[0],
    //         raffle_admin
    //     );

    //     // buyers 2,3,4 buy 1 each
    //     for (let i = 1; i < 4; i++) {
    //         await buyTickets(
    //             program,
    //             rafflePda,
    //             raffleId,
    //             buyers[i],
    //             1,
    //             ticketMint,
    //             ticketEscrow,
    //             buyerTicketAtas[i],
    //             raffle_admin
    //         );
    //     }

    //     // --- Warp to END TIME ---
    //     await warpForward(20_000); // past end time

    //     // --- WINNERS ARRAY (we pick all 4 buyers as winners) ---
    //     const winners = [buyers[0].publicKey, buyers[1].publicKey, buyers[0].publicKey];

    //     // --- BALANCES BEFORE ---
    //     const treasuryBefore = await getTokenBalance(ticketFeeTreasury);
    //     const escrowBefore = await getTokenBalance(ticketEscrow);
    //     const creatorBefore = await getSolBalance(raffle_1_creator.publicKey);
    //     const rafflePdaBeforeSol = await getSolBalance(rafflePda);

    //     const buyerBalancesBefore = [];
    //     for (let i = 0; i < 4; i++) {
    //         buyerBalancesBefore.push({
    //             buyer: buyers[i].publicKey.toBase58(),
    //             spl: await getTokenBalance(buyerTicketAtas[i]),
    //             sol: await getSolBalance(buyers[i].publicKey),
    //         });
    //     }

    //     console.log("\n=== BEFORE ANNOUNCE WINNERS ===");
    //     console.log("Treasury:", treasuryBefore);
    //     console.log("Ticket Escrow:", escrowBefore);
    //     console.log("Creator SOL:", creatorBefore);
    //     console.log("Raffle PDA SOL:", rafflePdaBeforeSol);
    //     console.log("Buyers:", buyerBalancesBefore);

    //     // --- ANNOUNCE WINNERS ---
    //     await announceWinners(
    //         program,
    //         rafflePda,
    //         raffleId,
    //         raffle_admin,
    //         winners,
    //         ticketMint,
    //         ticketEscrow,
    //         ticketFeeTreasury
    //     );

    //     // --- BALANCES AFTER ---
    //     const treasuryAfter = await getTokenBalance(ticketFeeTreasury);
    //     const escrowAfter = await getTokenBalance(ticketEscrow);
    //     const creatorAfter = await getSolBalance(raffle_1_creator.publicKey);
    //     const rafflePdaAfterSol = await getSolBalance(rafflePda);

    //     const buyerBalancesAfter = [];
    //     for (let i = 0; i < 4; i++) {
    //         buyerBalancesAfter.push({
    //             buyer: buyers[i].publicKey.toBase58(),
    //             spl: await getTokenBalance(buyerTicketAtas[i]),
    //             sol: await getSolBalance(buyers[i].publicKey),
    //         });
    //     }

    //     console.log("\n=== AFTER ANNOUNCE WINNERS ===");
    //     console.log("Treasury:", treasuryAfter);
    //     console.log("Ticket Escrow:", escrowAfter);
    //     console.log("Creator SOL:", creatorAfter);
    //     console.log("Raffle PDA SOL:", rafflePdaAfterSol);
    //     console.log("Buyers:", buyerBalancesAfter);

    //     // --- ASSERTIONS ---
    //     const raffleAcc = await program.account.raffle.fetch(rafflePda);
    //     assert.deepStrictEqual(raffleAcc.status, { successEnded: {} });
    //     assert.strictEqual(raffleAcc.winners.length, 3);

    //     // fee check
    //     const totalTickets = 2 + 1 + 1 + 1; // = 5
    //     const expectedRevenue = totalTickets * raffleAcc.ticketPrice.toNumber();
    //     const expectedFee = Math.floor(expectedRevenue * (ticket_fee_bps / 10000));

    //     assert.strictEqual(treasuryAfter - treasuryBefore, expectedFee);

    //     // Escrow should decrease by revenue - fee (creator share)
    //     const expectedCreatorShare = expectedRevenue - expectedFee;
    //     assert.equal(
    //         raffleAcc.claimableTicketAmount,
    //         expectedCreatorShare
    //     );

    //     assert.equal(
    //         raffleAcc.claimablePrizeBack,
    //         0
    //     );
    // });

    // it("Buyer-1(2 time winner) & buyer-2 will claim the prizes", async () => {
    //     const raffle = splRaffle;
    //     const {
    //         raffleId,
    //         rafflePda,
    //         ticketMint,
    //         prizeMint,
    //         prizeEscrow,
    //         creatorPrizeAta,
    //         ticketEscrow,
    //         ticketFeeTreasury,
    //     } = raffle;

    //     // ---------------------------------------------------
    //     // Re-create buyers for this test
    //     // ---------------------------------------------------
    //     const buyers = Array.from({ length: 4 }, () => Keypair.generate());

    //     for (const buyer of buyers) {
    //         await context.setAccount(buyer.publicKey, {
    //             lamports: 20_000_000_000,
    //             owner: anchor.web3.SystemProgram.programId,
    //             executable: false,
    //             data: Buffer.alloc(0),
    //         });
    //     }

    //     // Create buyer ATAs + mint ticket SPL to them
    //     const buyerTicketAtas: PublicKey[] = [];
    //     for (const buyer of buyers) {
    //         const ata = await createAta(ticketMint, buyer.publicKey);
    //         buyerTicketAtas.push(ata);
    //         await mintTokens(ticketMint, ata, 1_000_000_000_000);
    //     }

    //     // ---------------------------------------------------
    //     // Buy tickets: buyer-1 buys 2, others buy 1
    //     // ---------------------------------------------------
    //     await buyTickets(
    //         program,
    //         rafflePda,
    //         raffleId,
    //         buyers[0],
    //         2,
    //         ticketMint,
    //         ticketEscrow,
    //         buyerTicketAtas[0],
    //         raffle_admin
    //     );

    //     for (let i = 1; i < 4; i++) {
    //         await buyTickets(
    //             program,
    //             rafflePda,
    //             raffleId,
    //             buyers[i],
    //             1,
    //             ticketMint,
    //             ticketEscrow,
    //             buyerTicketAtas[i],
    //             raffle_admin
    //         );
    //     }

    //     // ---------------------------------------------------
    //     // Warp time past end timestamp
    //     // ---------------------------------------------------
    //     await warpForward(20_000);

    //     // ---------------------------------------------------
    //     // Winners: buyer-1 wins twice, buyer-2 wins once
    //     // ---------------------------------------------------
    //     const winners = [
    //         buyers[0].publicKey, // buyer-1 (winner idx 0)
    //         buyers[1].publicKey, // buyer-2 (winner idx 1)
    //         buyers[0].publicKey  // buyer-1 again (winner idx 2)
    //     ];

    //     await announceWinners(
    //         program,
    //         rafflePda,
    //         raffleId,
    //         raffle_admin,
    //         winners,
    //         ticketMint,
    //         ticketEscrow,
    //         ticketFeeTreasury
    //     );

    //     // ---------------------------------------------------
    //     // Verify announced winner state
    //     // ---------------------------------------------------
    //     const raffleAcc = await program.account.raffle.fetch(rafflePda);
    //     assert.deepStrictEqual(raffleAcc.status, { successEnded: {} });

    //     // ---------------------------------------------------
    //     // Prepare Winner ATAs for SPL Prize
    //     // ---------------------------------------------------
    //     const buyer1PrizeAta = await createAta(prizeMint, buyers[0].publicKey);
    //     const buyer2PrizeAta = await createAta(prizeMint, buyers[1].publicKey);

    //     const escrowBefore = await getTokenBalance(prizeEscrow);
    //     const b1Before = await getTokenBalance(buyer1PrizeAta);
    //     const b2Before = await getTokenBalance(buyer2PrizeAta);

    //     // ---------------------------------------------------
    //     // Expected prize amounts
    //     // ---------------------------------------------------
    //     const totalPrize = raffleAcc.prizeAmount.toNumber();

    //     const pct0 = raffleAcc.winShares[0]; // 50%
    //     const pct1 = raffleAcc.winShares[1]; // 30%
    //     const pct2 = raffleAcc.winShares[2]; // 20%

    //     const buyer1Expected = Math.floor((totalPrize * pct0) / 100)
    //         + Math.floor((totalPrize * pct2) / 100);
    //     const buyer2Expected = Math.floor((totalPrize * pct1) / 100);

    //     // ---------------------------------------------------
    //     // CLAIM #1: Buyer-1 → claims two winnings
    //     // ---------------------------------------------------
    //     await program.methods.buyerClaimPrize(raffleId)
    //         .accounts({
    //             raffleConfig: raffleConfigPda(),
    //             raffle: rafflePda,
    //             buyerAccount: PublicKey.findProgramAddressSync(
    //                 [
    //                     Buffer.from("raffle"),
    //                     new anchor.BN(raffleId).toArrayLike(Buffer, "le", 4),
    //                     buyers[0].publicKey.toBuffer(),
    //                 ],
    //                 program.programId
    //             )[0],
    //             raffleAdmin: raffle_admin.publicKey,
    //             winner: buyers[0].publicKey,
    //             prizeMint,
    //             prizeEscrow,
    //             winnerPrizeAta: buyer1PrizeAta,
    //             prizeTokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
    //             systemProgram: anchor.web3.SystemProgram.programId,
    //         })
    //         .signers([buyers[0], raffle_admin])
    //         .rpc();

    //     // ---------------------------------------------------
    //     // CLAIM #2: Buyer-2 → claims one winning
    //     // ---------------------------------------------------
    //     await program.methods.buyerClaimPrize(raffleId)
    //         .accounts({
    //             raffleConfig: raffleConfigPda(),
    //             raffle: rafflePda,
    //             buyerAccount: PublicKey.findProgramAddressSync(
    //                 [
    //                     Buffer.from("raffle"),
    //                     new anchor.BN(raffleId).toArrayLike(Buffer, "le", 4),
    //                     buyers[1].publicKey.toBuffer(),
    //                 ],
    //                 program.programId
    //             )[0],
    //             raffleAdmin: raffle_admin.publicKey,
    //             winner: buyers[1].publicKey,
    //             prizeMint,
    //             prizeEscrow,
    //             winnerPrizeAta: buyer2PrizeAta,
    //             prizeTokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
    //             systemProgram: anchor.web3.SystemProgram.programId,
    //         })
    //         .signers([buyers[1], raffle_admin])
    //         .rpc();

    //     // ---------------------------------------------------
    //     // Final balances
    //     // ---------------------------------------------------
    //     const escrowAfter = await getTokenBalance(prizeEscrow);
    //     const b1After = await getTokenBalance(buyer1PrizeAta);
    //     const b2After = await getTokenBalance(buyer2PrizeAta);

    //     // Assertions
    //     assert.strictEqual(
    //         b1After - b1Before,
    //         buyer1Expected,
    //         "Buyer-1 ATA must increase by their total SPL claim"
    //     );

    //     assert.strictEqual(
    //         b2After - b2Before,
    //         buyer2Expected,
    //         "Buyer-2 ATA must increase by their claim"
    //     );

    //     assert.strictEqual(
    //         escrowBefore - escrowAfter,
    //         buyer1Expected + buyer2Expected,
    //         "Prize escrow must decrease exactly by total claims"
    //     );

    //     // Ensure no more SPL prize left for claim back
    //     const raffleFinal = await program.account.raffle.fetch(rafflePda);
    //     assert.strictEqual(
    //         raffleFinal.claimablePrizeBack.toNumber(),
    //         0,
    //         "Prize back must remain 0"
    //     );

    //     console.log("\n=== CLAIM RESULTS ===");
    //     console.log("Buyer-1 claimed:", b1After - b1Before);
    //     console.log("Buyer-2 claimed:", b2After - b2Before);
    //     console.log("Escrow decreased:", escrowBefore - escrowAfter);
    // });

    // it("SOL raffle → announce winners + buyer-1, buyer-2, buyer-4 claim SOL prizes", async () => {
    //     const raffle = solRaffle;
    //     const {
    //         raffleId,
    //         rafflePda,
    //         ticketMint,
    //         prizeMint,
    //         prizeEscrow,
    //         creatorPrizeAta,
    //         ticketEscrow,
    //         ticketFeeTreasury,
    //     } = raffle;

    //     // ---------------------------------------------------
    //     // Create 4 buyers
    //     // ---------------------------------------------------
    //     const buyers = Array.from({ length: 4 }, () => Keypair.generate());

    //     for (const buyer of buyers) {
    //         await context.setAccount(buyer.publicKey, {
    //             lamports: 20_000_000_000,
    //             owner: anchor.web3.SystemProgram.programId,
    //             executable: false,
    //             data: Buffer.alloc(0),
    //         });
    //     }

    //     // dummy ATA
    //     const buyerTicketAtas: PublicKey[] = [];
    //     for (const buyer of buyers) {
    //         const ata = await createAta(ticketMint, buyer.publicKey);
    //         buyerTicketAtas.push(ata);
    //         await mintTokens(ticketMint, ata, 1_000_000_000);
    //     }

    //     // ---------------------------------------------------
    //     // Buy tickets
    //     // ---------------------------------------------------
    //     await buyTickets(
    //         program,
    //         rafflePda,
    //         raffleId,
    //         buyers[0],
    //         2,
    //         ticketMint,
    //         ticketEscrow,
    //         buyerTicketAtas[0],
    //         raffle_admin
    //     );

    //     for (let i = 1; i < 4; i++) {
    //         await buyTickets(
    //             program,
    //             rafflePda,
    //             raffleId,
    //             buyers[i],
    //             1,
    //             ticketMint,
    //             ticketEscrow,
    //             buyerTicketAtas[i],
    //             raffle_admin
    //         );
    //     }

    //     // ---------------------------------------------------
    //     // Time travel
    //     // ---------------------------------------------------
    //     await warpForward(20_000);

    //     // ---------------------------------------------------
    //     // WINNERS — unique required → pick buyer-1, buyer-2, buyer-4
    //     // ---------------------------------------------------
    //     const winners = [
    //         buyers[0].publicKey, // winner share 50%
    //         buyers[1].publicKey, // share 30%
    //         buyers[3].publicKey, // share 20%
    //     ];

    //     const before = {
    //         configSol: await getSolBalance(raffleConfigPda()),
    //         raffleSol: await getSolBalance(rafflePda),
    //         buyer1Sol: await getSolBalance(buyers[0].publicKey),
    //         buyer2Sol: await getSolBalance(buyers[1].publicKey),
    //         buyer4Sol: await getSolBalance(buyers[3].publicKey),
    //     };
    //     console.log("Before claim sol balances => ", before)
    //     /*
    //     Before claim sol balances =>  {
    //       configSol: 201_559_040n,
    //       raffleSol: 1_504_510_080n,
    //       buyer1Sol: 19798788960n,
    //       buyer2Sol: 19898788960n,
    //       buyer4Sol: 19898788960n
    //     }
    //     After claim sol balances =>  {
    //       configSol: 206_559_040n,
    //       raffleSol: 499_510_080n,
    //       buyer1Sol: 20300000000n,
    //       buyer2Sol: 20200000000n,
    //       buyer4Sol: 20100000000n
    //     }
    //     */
    //     // ---------------------------------------------------
    //     // ANNOUNCE WINNERS
    //     // ---------------------------------------------------
    //     await announceWinners(
    //         program,
    //         rafflePda,
    //         raffleId,
    //         raffle_admin,
    //         winners,
    //         ticketMint,
    //         ticketEscrow,
    //         ticketFeeTreasury
    //     );

    //     const raffleAcc = await program.account.raffle.fetch(rafflePda);
    //     assert.deepStrictEqual(raffleAcc.status, { successEnded: {} });

    //     // ---------------------------------------------------
    //     // Expected prize amounts
    //     // ---------------------------------------------------
    //     const totalPrize = raffleAcc.prizeAmount.toNumber();

    //     const buyer1Expected = Math.floor(totalPrize * 0.50);
    //     const buyer2Expected = Math.floor(totalPrize * 0.30);
    //     const buyer4Expected = Math.floor(totalPrize * 0.20);

    //     // PDAs
    //     const buyerPda = (buyer) =>
    //         PublicKey.findProgramAddressSync(
    //             [
    //                 Buffer.from("raffle"),
    //                 new anchor.BN(raffleId).toArrayLike(Buffer, "le", 4),
    //                 buyer.publicKey.toBuffer(),
    //             ],
    //             program.programId
    //         )[0];

    //     // ---------------------------------------------------
    //     // CLAIM: buyer-1
    //     // ---------------------------------------------------
    //     await program.methods
    //         .buyerClaimPrize(raffleId)
    //         .accounts({
    //             raffleConfig: raffleConfigPda(),
    //             raffle: rafflePda,
    //             buyerAccount: buyerPda(buyers[0]),
    //             raffleAdmin: raffle_admin.publicKey,
    //             winner: buyers[0].publicKey,
    //             prizeMint,
    //             prizeEscrow,
    //             winnerPrizeAta: creatorPrizeAta,
    //             prizeTokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
    //             systemProgram: anchor.web3.SystemProgram.programId,
    //         })
    //         .signers([buyers[0], raffle_admin])
    //         .rpc();

    //     // ---------------------------------------------------
    //     // CLAIM: buyer-2
    //     // ---------------------------------------------------
    //     await program.methods
    //         .buyerClaimPrize(raffleId)
    //         .accounts({
    //             raffleConfig: raffleConfigPda(),
    //             raffle: rafflePda,
    //             buyerAccount: buyerPda(buyers[1]),
    //             raffleAdmin: raffle_admin.publicKey,
    //             winner: buyers[1].publicKey,
    //             prizeMint,
    //             prizeEscrow,
    //             winnerPrizeAta: creatorPrizeAta,
    //             prizeTokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
    //             systemProgram: anchor.web3.SystemProgram.programId,
    //         })
    //         .signers([buyers[1], raffle_admin])
    //         .rpc();

    //     // ---------------------------------------------------
    //     // CLAIM: buyer-4
    //     // ---------------------------------------------------
    //     await program.methods
    //         .buyerClaimPrize(raffleId)
    //         .accounts({
    //             raffleConfig: raffleConfigPda(),
    //             raffle: rafflePda,
    //             buyerAccount: buyerPda(buyers[3]),
    //             raffleAdmin: raffle_admin.publicKey,
    //             winner: buyers[3].publicKey,
    //             prizeMint,
    //             prizeEscrow,
    //             winnerPrizeAta: creatorPrizeAta,
    //             prizeTokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
    //             systemProgram: anchor.web3.SystemProgram.programId,
    //         })
    //         .signers([buyers[3], raffle_admin])
    //         .rpc();

    //     // ---------------------------------------------------
    //     // AFTER BALANCES
    //     // ---------------------------------------------------
    //     const after = {
    //         claimableTicketAmount: Number(raffleAcc.claimableTicketAmount),
    //         configSol: await getSolBalance(raffleConfigPda()),
    //         raffleSol: await getSolBalance(rafflePda),
    //         buyer1Sol: await getSolBalance(buyers[0].publicKey),
    //         buyer2Sol: await getSolBalance(buyers[1].publicKey),
    //         buyer4Sol: await getSolBalance(buyers[3].publicKey),
    //     };

    //     console.log("After claim sol balances => ", after)

    //     assert.ok(after.buyer1Sol - before.buyer1Sol > buyer1Expected);
    //     assert.ok(after.buyer2Sol - before.buyer2Sol > buyer2Expected);
    //     assert.ok(after.buyer4Sol - before.buyer4Sol > buyer4Expected);

    //     assert.ok(
    //         before.raffleSol - after.raffleSol >
    //         buyer1Expected + buyer2Expected + buyer4Expected
    //     );

    //     console.log("SOL prize claim OK");
    // });

    it("Creator claims leftover SPL prize + ticket revenue (claim_amount_back)", async () => {
        const raffle = splRaffle;
        const {
            raffleId,
            rafflePda,
            ticketMint,
            prizeMint,
            ticketEscrow,
            prizeEscrow,
            creatorPrizeAta,
            ticketFeeTreasury,
        } = raffle;

        console.log("\n======= CLAIM AMOUNT BACK TEST (SPL RAFFLE) =======");

        // ---------------------------------------------------
        // STEP 1: Create & Fund Buyers
        // ---------------------------------------------------
        const buyers = Array.from({ length: 4 }, () => Keypair.generate());

        for (const buyer of buyers) {
            await context.setAccount(buyer.publicKey, {
                lamports: 10_000_000_000,
                owner: anchor.web3.SystemProgram.programId,
                executable: false,
                data: Buffer.alloc(0),
            });
        }

        console.log("Created buyers:", buyers.map(b => b.publicKey.toBase58()));

        // ---------------------------------------------------
        // STEP 2: Create Buyer Ticket ATAs + Mint SPL
        // ---------------------------------------------------
        const buyerTicketAtas: PublicKey[] = [];
        for (const buyer of buyers) {
            const ata = await createAta(ticketMint, buyer.publicKey);
            buyerTicketAtas.push(ata);
            await mintTokens(ticketMint, ata, 1_000_000_000_000);
        }

        console.log("Buyer ticket ATAs created.");

        // ---------------------------------------------------
        // STEP 3: Buyers Purchase Tickets
        // ---------------------------------------------------
        await buyTickets(program, rafflePda, raffleId, buyers[0], 2, ticketMint, ticketEscrow, buyerTicketAtas[0], raffle_admin);
        for (let i = 1; i < 4; i++) {
            await buyTickets(program, rafflePda, raffleId, buyers[i], 1, ticketMint, ticketEscrow, buyerTicketAtas[i], raffle_admin);
        }

        console.log("Tickets purchased. Buyer1=2 tickets, others=1 each.");

        // ---------------------------------------------------
        // STEP 4: Warp Time Past End
        // ---------------------------------------------------
        await warpForward(20_000);
        console.log("Warped forward to end time.");

        // ---------------------------------------------------
        // STEP 5: Set Winners
        // ---------------------------------------------------
        const winners = [
            buyers[0].publicKey, // 50%
            buyers[1].publicKey, // 30%
            buyers[0].publicKey, // 20%
        ];

        console.log("Winners:", winners.map(w => w.toBase58()));

        await announceWinners(
            program, rafflePda, raffleId, raffle_admin,
            winners, ticketMint, ticketEscrow, ticketFeeTreasury
        );

        let raffleAcc = await program.account.raffle.fetch(rafflePda);
        console.log("Raffle status after announce:", raffleAcc.status);

        // ---------------------------------------------------
        // STEP 6: Winners Claim SPL Prize
        // ---------------------------------------------------
        const buyer1PrizeAta = await createAta(prizeMint, buyers[0].publicKey);
        const buyer2PrizeAta = await createAta(prizeMint, buyers[1].publicKey);

        const prizeEscrowBefore = await getTokenBalance(prizeEscrow);

        await buyerClaimPrize(program, rafflePda, raffleId, buyers[0], raffle_admin, prizeMint, prizeEscrow, buyer1PrizeAta);
        await buyerClaimPrize(program, rafflePda, raffleId, buyers[1], raffle_admin, prizeMint, prizeEscrow, buyer2PrizeAta);

        const prizeEscrowAfterPrizeClaims = await getTokenBalance(prizeEscrow);

        console.log("\n--- After Winner Prize Claims ---");
        console.log("Prize escrow before:", prizeEscrowBefore);
        console.log("Prize escrow after claims:", prizeEscrowAfterPrizeClaims);

        // ---------------------------------------------------
        // STEP 7: Prepare Creator ATAs
        // ---------------------------------------------------
        const creatorTicketAta = await createAta(ticketMint, raffle_1_creator.publicKey);

        const creatorPrizeBefore = await getTokenBalance(creatorPrizeAta);
        const creatorTicketBefore = await getTokenBalance(creatorTicketAta);
        const creatorSolBefore = await getSolBalance(raffle_1_creator.publicKey);

        console.log("\n--- Creator Balances Before Claim Back ---");
        console.log("Creator SPL prize ATA:", creatorPrizeBefore);
        console.log("Creator SPL ticket ATA:", creatorTicketBefore);
        console.log("Creator SOL:", creatorSolBefore);

        // ---------------------------------------------------
        // STEP 8: CALL claim_amount_back()
        // ---------------------------------------------------
        await program.methods
            .claimAmountBack(raffleId)
            .accounts({
                raffleConfig: raffleConfigPda(),
                raffle: rafflePda,
                creator: raffle_1_creator.publicKey,
                raffleAdmin: raffle_admin.publicKey,
                prizeMint,
                ticketMint,
                prizeEscrow,
                ticketEscrow,
                creatorPrizeAta,
                creatorTicketAta,
                prizeTokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
                ticketTokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
                systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([raffle_1_creator, raffle_admin])
            .rpc();

        // ---------------------------------------------------
        // STEP 9: Final Balances
        // ---------------------------------------------------
        const creatorPrizeAfter = await getTokenBalance(creatorPrizeAta);
        const creatorTicketAfter = await getTokenBalance(creatorTicketAta);
        const creatorSolAfter = await getSolBalance(raffle_1_creator.publicKey);

        let ticketEscrowBalanceAfter = 0;
        try {
            ticketEscrowBalanceAfter = await getTokenBalance(ticketEscrow);
        } catch (_) {
            ticketEscrowBalanceAfter = 0;
        }

        raffleAcc = await program.account.raffle.fetch(rafflePda);

        console.log("\n======= FINAL CLAIM BACK RESULTS =======");
        console.log("Creator SPL Prize Before:", creatorPrizeBefore);
        console.log("Creator SPL Prize After:", creatorPrizeAfter);
        console.log("Creator Prize Increase:", creatorPrizeAfter - creatorPrizeBefore);

        console.log("Creator Ticket SPL Before:", creatorTicketBefore);
        console.log("Creator Ticket SPL After:", creatorTicketAfter);
        console.log("Creator Ticket Increase:", creatorTicketAfter - creatorTicketBefore);

        console.log("Creator SOL Before:", creatorSolBefore);
        console.log("Creator SOL After:", creatorSolAfter);
        console.log("Creator SOL Increase:", creatorSolAfter - creatorSolBefore);

        console.log("\nPrize Escrow Before Claims:", prizeEscrowBefore);
        console.log("Prize Escrow After Winner Claims:", prizeEscrowAfterPrizeClaims);
        console.log("Ticket Escrow After Claim Back:", ticketEscrowBalanceAfter);

        console.log("\nRaffle Claimable Prize Back:", raffleAcc.claimablePrizeBack.toNumber());
        console.log("Raffle Claimable Ticket Amount:", raffleAcc.claimableTicketAmount.toNumber());

        console.log("====================================================\n");
    });

    it("Raffle owner withdraws SPL fees from config treasury ATA", async () => {
        const raffle = splRaffle;
        const {
            raffleId,
            ticketMint,
            ticketFeeTreasury,
        } = raffle;

        console.log("\n==================== SPL FEE WITHDRAW TEST ====================");

        // ---------------------------------------------------------------
        // STEP 1: Create ATA for raffle_owner to receive SPL fees
        // ---------------------------------------------------------------
        const ownerFeeAta = await createAta(ticketMint, raffle_owner.publicKey);

        const treasuryBefore = await getTokenBalance(ticketFeeTreasury);
        const ownerBefore = await getTokenBalance(ownerFeeAta);

        console.log("\n--- BEFORE WITHDRAW SPL FEES ---");
        console.log("Treasury SPL Fee ATA:", treasuryBefore);
        console.log("Owner SPL Fee ATA:", ownerBefore);

        // ---------------------------------------------------------------
        // STEP 2: Decide how much to withdraw
        // ---------------------------------------------------------------
        // Withdraw full amount (can be partial)
        const withdrawAmount = treasuryBefore;

        console.log("\nWithdraw Amount:", withdrawAmount);

        // ---------------------------------------------------------------
        // STEP 3: WITHDRAW CALL
        // Only raffle_owner can call this instruction
        // ---------------------------------------------------------------
        await program.methods
            .withdrawSplFees(new anchor.BN(withdrawAmount))
            .accounts({
                raffleConfig: raffleConfigPda(),
                owner: raffle_owner.publicKey,
                feeMint: ticketMint,
                feeTreasuryAta: ticketFeeTreasury,
                receiverFeeAta: ownerFeeAta,
                tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
                systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([raffle_owner])
            .rpc();

        // ---------------------------------------------------------------
        // STEP 4: BALANCES AFTER WITHDRAW
        // ---------------------------------------------------------------
        const treasuryAfter = await getTokenBalance(ticketFeeTreasury);
        const ownerAfter = await getTokenBalance(ownerFeeAta);

        console.log("\n--- AFTER WITHDRAW SPL FEES ---");
        console.log("Treasury SPL Fee ATA:", treasuryAfter);
        console.log("Owner SPL Fee ATA:", ownerAfter);

        console.log("\n--- SPL FEE WITHDRAW SUMMARY ---");
        console.log("Treasury Decrease:", treasuryBefore - treasuryAfter);
        console.log("Owner Increase:", ownerAfter - ownerBefore);
        console.log("===============================================================\n");
    });


    // it("SOL raffle → buyers buy tickets, winners selected, announce winners, creator claims leftover SOL (claim_amount_back)", async () => {
    //     const raffle = solRaffle;
    //     const {
    //         raffleId,
    //         rafflePda,
    //         ticketMint,
    //         prizeMint,
    //         ticketEscrow,
    //         prizeEscrow,
    //         creatorPrizeAta,
    //         ticketFeeTreasury,
    //     } = raffle;

    //     console.log("\n================= SOL CLAIM AMOUNT BACK – FULL TEST =================");

    //     // -------------------------------------------------------
    //     // 1) Setup 4 BUYERS
    //     // -------------------------------------------------------
    //     const buyers = Array.from({ length: 4 }, () => Keypair.generate());
    //     for (const b of buyers) {
    //         await context.setAccount(b.publicKey, {
    //             lamports: 10_000_000_000,
    //             owner: anchor.web3.SystemProgram.programId,
    //             executable: false,
    //             data: Buffer.alloc(0),
    //         });
    //     }

    //     console.log("\nBuyers:");
    //     buyers.forEach((b, i) => console.log(` - Buyer-${i + 1}:`, b.publicKey.toBase58()));

    //     // Dummy ATAs required by helpers
    //     const buyerTicketAtas = [];
    //     for (const buyer of buyers) {
    //         const ata = await createAta(ticketMint, buyer.publicKey);
    //         buyerTicketAtas.push(ata);
    //         await mintTokens(ticketMint, ata, 10_000_000); // irrelevant for SOL raffle
    //     }

    //     // -------------------------------------------------------
    //     // 2) Buyers purchase tickets
    //     // -------------------------------------------------------
    //     await buyTickets(
    //         program, rafflePda, raffleId,
    //         buyers[0], 1, ticketMint, ticketEscrow, buyerTicketAtas[0], raffle_admin
    //     );
    //     await buyTickets(
    //         program, rafflePda, raffleId,
    //         buyers[1], 1, ticketMint, ticketEscrow, buyerTicketAtas[1], raffle_admin
    //     );
    //     await buyTickets(
    //         program, rafflePda, raffleId,
    //         buyers[2], 1, ticketMint, ticketEscrow, buyerTicketAtas[2], raffle_admin
    //     );
    //     // buyer-4 buys no tickets

    //     console.log("\nTicket Purchase Complete:");
    //     console.log("Buyer-1 bought 1 ticket");
    //     console.log("Buyer-2 bought 1 ticket");
    //     console.log("Buyer-3 bought 1 ticket");
    //     console.log("Buyer-4 bought 0 tickets");

    //     // -------------------------------------------------------
    //     // 3) Warp past end time
    //     // -------------------------------------------------------
    //     await warpForward(20_000);
    //     console.log("\nWarped beyond raffle end time.");

    //     // -------------------------------------------------------
    //     // 4) Select Winners
    //     // Buyer-1 and Buyer-2 win. Buyer-3 and Buyer-4 lose.
    //     // -------------------------------------------------------
    //     const winners = [
    //         buyers[0].publicKey, // winner index 0
    //         buyers[1].publicKey, // winner index 1
    //         buyers[2].publicKey, // winner index 2 (not winning in real logic but we override manually)
    //     ];

    //     console.log("\nWinners Selected:");
    //     winners.forEach((w, i) =>
    //         console.log(` - Winner idx ${i}: ${w.toBase58()}`)
    //     );

    //     // -------------------------------------------------------
    //     // 5) Log BEFORE ANNOUNCE WINNERS balances
    //     // -------------------------------------------------------
    //     const before = {
    //         raffleSol: await getSolBalance(rafflePda),
    //         creatorSol: await getSolBalance(raffle_1_creator.publicKey),
    //         buyers: await Promise.all(
    //             buyers.map(async (b) => ({
    //                 buyer: b.publicKey.toBase58(),
    //                 sol: await getSolBalance(b.publicKey),
    //             }))
    //         ),
    //         ticketEscrowSpl: await getTokenBalance(ticketEscrow),
    //         prizeEscrowSpl: await getTokenBalance(prizeEscrow),
    //         treasurySpl: await getTokenBalance(ticketFeeTreasury),
    //     };

    //     console.log("\n--- BEFORE ANNOUNCE_WINNERS ---");
    //     console.log("Creator SOL:", before.creatorSol);
    //     console.log("Raffle PDA SOL:", before.raffleSol);
    //     console.log("Ticket Escrow SPL:", before.ticketEscrowSpl);
    //     console.log("Prize Escrow SPL:", before.prizeEscrowSpl);
    //     console.log("Fee Treasury SPL:", before.treasurySpl);
    //     console.log("Buyer Balances:");
    //     console.log(before.buyers);

    //     // -------------------------------------------------------
    //     // 6) ANNOUNCE WINNERS
    //     // -------------------------------------------------------
    //     await announceWinners(
    //         program,
    //         rafflePda,
    //         raffleId,
    //         raffle_admin,
    //         winners,
    //         ticketMint,
    //         ticketEscrow,
    //         ticketFeeTreasury
    //     );

    //     let raffleAcc = await program.account.raffle.fetch(rafflePda);
    //     console.log("\nAnnounce Winners complete.");
    //     console.log("Raffle status:", raffleAcc.status);
    //     console.log("Claimable Prize Back:", raffleAcc.claimablePrizeBack.toString());
    //     console.log("Claimable Ticket Back:", raffleAcc.claimableTicketAmount.toString());

    //     // -------------------------------------------------------
    //     // 7) Buyers’ balances BEFORE creator claim
    //     // -------------------------------------------------------
    //     const buyersMid = await Promise.all(
    //         buyers.map(async (b) => ({
    //             buyer: b.publicKey.toBase58(),
    //             sol: await getSolBalance(b.publicKey),
    //         }))
    //     );

    //     console.log("\n--- AFTER ANNOUNCE_WINNERS (Before Claim Back) ---");
    //     console.log(buyersMid);

    //     // -------------------------------------------------------
    //     // 8) BALANCES BEFORE CLAIM BACK
    //     // -------------------------------------------------------
    //     const beforeClaim = {
    //         creatorSol: await getSolBalance(raffle_1_creator.publicKey),
    //         raffleSol: await getSolBalance(rafflePda),
    //         ticketEscrowSpl: await getTokenBalance(ticketEscrow),
    //         prizeEscrowSpl: await getTokenBalance(prizeEscrow),
    //     };

    //     console.log("\n--- BEFORE CLAIM_AMOUNT_BACK ---");
    //     console.log("Creator SOL:", beforeClaim.creatorSol);
    //     console.log("Raffle PDA SOL:", beforeClaim.raffleSol);
    //     console.log("Prize Back:", raffleAcc.claimablePrizeBack.toNumber());
    //     console.log("Ticket Back:", raffleAcc.claimableTicketAmount.toNumber());
    //     console.log("Ticket Escrow SPL:", beforeClaim.ticketEscrowSpl);
    //     console.log("Prize Escrow SPL:", beforeClaim.prizeEscrowSpl);

    //     // -------------------------------------------------------
    //     // 9) Creator calls claim_amount_back()
    //     // -------------------------------------------------------
    //     await program.methods
    //         .claimAmountBack(raffleId)
    //         .accounts({
    //             raffleConfig: raffleConfigPda(),
    //             raffle: rafflePda,
    //             creator: raffle_1_creator.publicKey,
    //             raffleAdmin: raffle_admin.publicKey,
    //             prizeMint,
    //             ticketMint,
    //             prizeEscrow,
    //             ticketEscrow,
    //             creatorPrizeAta,
    //             creatorTicketAta: creatorPrizeAta,
    //             prizeTokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
    //             ticketTokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
    //             systemProgram: anchor.web3.SystemProgram.programId,
    //         })
    //         .signers([raffle_1_creator, raffle_admin])
    //         .rpc();

    //     // -------------------------------------------------------
    //     // 10) BALANCES AFTER CLAIM BACK
    //     // -------------------------------------------------------
    //     const afterClaim = {
    //         creatorSol: await getSolBalance(raffle_1_creator.publicKey),
    //         raffleSol: await getSolBalance(rafflePda),
    //         ticketEscrowSpl: await getTokenBalance(ticketEscrow),
    //         prizeEscrowSpl: await getTokenBalance(prizeEscrow),
    //     };

    //     raffleAcc = await program.account.raffle.fetch(rafflePda);

    //     console.log("\n--- AFTER CLAIM_AMOUNT_BACK ---");
    //     console.log("Creator SOL:", afterClaim.creatorSol);
    //     console.log("Raffle PDA SOL:", afterClaim.raffleSol);
    //     console.log("Ticket Escrow SPL:", afterClaim.ticketEscrowSpl);
    //     console.log("Prize Escrow SPL:", afterClaim.prizeEscrowSpl);
    //     console.log("Claimable Prize Back:", raffleAcc.claimablePrizeBack.toNumber());
    //     console.log("Claimable Ticket Back:", raffleAcc.claimableTicketAmount.toNumber());

    //     console.log("\n--- SOL MOVEMENT SUMMARY ---");
    //     console.log("Creator gained:", afterClaim.creatorSol - beforeClaim.creatorSol);
    //     console.log("Raffle PDA lost:", beforeClaim.raffleSol - afterClaim.raffleSol);

    //     console.log("\n================= END SOL CLAIM AMOUNT BACK TEST =================\n");
    // });

});
