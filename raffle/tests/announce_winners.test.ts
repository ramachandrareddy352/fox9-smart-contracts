import assert from "assert";
import * as anchor from "@coral-xyz/anchor";
import { startAnchor } from "solana-bankrun";
import { BankrunProvider } from "anchor-bankrun";
import { PublicKey } from "@solana/web3.js";

import {
    createRaffleConfig,
    createSplMint,
    createRaffle,
    buildCreateRaffleAccounts,
    mintTokens,
    createAta,
    getCurrentTimestamp,
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
        //  - startTime in the future, autoStart = false (activate later)
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
        const start = now + 100;     // future
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
                unique: true,
                autoStart: false,         // need explicit activateRaffle later
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

    // ------------------------------------------------------------------------
    // Simple sanity test to ensure setup is correct.
    // You can now use `solRaffle` and `splRaffle` in your announceWinners tests.
    // ------------------------------------------------------------------------
    it("sets up exactly two raffles (SOL + SPL)", async () => {
        const raffleSol = await program.account.raffle.fetch(solRaffle.rafflePda);
        const raffleSpl = await program.account.raffle.fetch(splRaffle.rafflePda);

        assert.strictEqual(raffleSol.raffleId, solRaffle.raffleId);
        assert.strictEqual(raffleSpl.raffleId, splRaffle.raffleId);

        // basic type checks
        assert.ok(raffleSol.ticketMint === null);
        assert.ok(raffleSpl.ticketMint !== null);
    });
});
