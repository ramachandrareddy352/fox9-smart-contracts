import assert from "assert";
import * as anchor from "@coral-xyz/anchor";
import { startAnchor, Clock } from "solana-bankrun";
import { BankrunProvider } from "anchor-bankrun";
import {
    createRaffleConfig,
    createSplMint,
    createRaffle,
    activateRaffle,
    cancelRaffle,
    getSolBalance,
    buildCreateRaffleAccounts
} from "./helpers";
import {
    raffle_owner,
    raffle_admin,
    raffle_1_creator,
    raffle_2_creator,
    raffle_3_creator,
    setProgram,
    setProvider,
    getProgram,
    getProvider,
    raffleConfigPda,
    rafflePda,
    minimum_raffle_period,
    maximum_raffle_period,
    creation_fee_lamports,
    ticket_fee_bps,
} from "./values";

// ----------------------------------------------------
// BANKRUN TEST SUITE FOR CANCEL RAFFLE
// ----------------------------------------------------
describe("Cancel Raffle – Bankrun", () => {
    let context: any;
    let provider: BankrunProvider;
    let program: anchor.Program<any>;

    before(async () => {
        context = await startAnchor("", [], []);
        provider = new BankrunProvider(context);
        anchor.setProvider(provider);
        setProvider(provider);

        program = anchor.workspace.Raffle as anchor.Program<any>;
        setProgram(program);

        // FUND ACCOUNTS
        await context.setAccount(raffle_owner.publicKey, {
            lamports: 20_000_000_000,
            owner: anchor.web3.SystemProgram.programId,
            executable: false,
            data: Buffer.alloc(0),
        });
        await context.setAccount(raffle_1_creator.publicKey, {
            lamports: 20_000_000_000,
            owner: anchor.web3.SystemProgram.programId,
            executable: false,
            data: Buffer.alloc(0),
        });
        await context.setAccount(raffle_2_creator.publicKey, {
            lamports: 20_000_000_000,
            owner: anchor.web3.SystemProgram.programId,
            executable: false,
            data: Buffer.alloc(0),
        });

        // CREATE CONFIG
        await createRaffleConfig(program, raffle_owner, raffle_admin.publicKey, {
            creationFeeLamports: creation_fee_lamports,
            ticketFeeBps: ticket_fee_bps,
            minPeriod: minimum_raffle_period,
            maxPeriod: maximum_raffle_period,
        });
    });

    // Utility: create one initialized raffle
    async function makeRaffle(
        creator: anchor.web3.Keypair,
        prizeMint: anchor.web3.PublicKey,
        prizeType: any,
    ) {
        const cfg = await program.account.raffleConfig.fetch(raffleConfigPda());
        const raffleId = cfg.raffleCount;
        const rafflePdaAddr = rafflePda(raffleId);

        const ticketMint = prizeMint; // OK, not used for SOL if needed
        const { ticketEscrow, prizeEscrow, creatorPrizeAta } =
            await buildAccounts(rafflePdaAddr, creator, ticketMint, prizeMint);

        const client = context.banksClient;
        const now = Number(await client.getClock().unixTimestamp);
        const start = now + 10;
        const end = now + 10000;

        await createRaffle(program, {
            startTime: start,
            endTime: end,
            totalTickets: 100,
            ticketPrice: 100_000,
            isTicketSol: true,
            maxPct: 30,
            prizeType,
            prizeAmount: 1_000_000_000,
            numWinners: 1,
            winShares: [100],
            unique: false,
            autoStart: false,
        }, {
            raffleConfig: raffleConfigPda(),
            rafflePda: rafflePdaAddr,
            creator,
            raffleAdmin: raffle_admin,
            ticketMint,
            prizeMint,
            ticketEscrow,
            prizeEscrow,
            creatorPrizeAta,
        });

        return { raffleId, rafflePdaAddr, ticketMint, prizeEscrow, creatorPrizeAta };
    }

    // small wrapper for your spl ATA builder
    async function buildAccounts(rafflePdaAddr, owner, ticketMint, prizeMint) {
        const { ticketEscrow, prizeEscrow, creatorPrizeAta } =
            await buildCreateRaffleAccounts(
                rafflePdaAddr,
                owner,
                ticketMint,
                prizeMint
            );
        return { ticketEscrow, prizeEscrow, creatorPrizeAta };
    }

    // ----------------------------------------------------
    // VALID — CANCEL INITIALIZED SOL RAFFLE BEFORE TICKETS
    // ----------------------------------------------------
    it("cancels initialized SOL raffle when zero tickets sold", async () => {
        const splMint = await createSplMint();
        const { raffleId, rafflePdaAddr, prizeEscrow, creatorPrizeAta } =
            await makeRaffle(raffle_1_creator, splMint, { sol: {} });

        const balBefore = await getSolBalance(raffle_1_creator.publicKey);

        await cancelRaffle(
            program,
            rafflePdaAddr,
            raffleId,
            raffle_1_creator,
            raffle_admin,
            splMint,
            prizeEscrow,
            creatorPrizeAta,
        );

        const balAfter = await getSolBalance(raffle_1_creator.publicKey);
        assert.ok(balAfter > balBefore);
    });

    // ----------------------------------------------------
    // VALID — CANCEL ACTIVE SPL RAFFLE ZERO TICKETS
    // ----------------------------------------------------
    it("cancels active SPL raffle", async () => {
        const splMint = await createSplMint();
        const { raffleId, rafflePdaAddr, prizeEscrow, creatorPrizeAta } =
            await makeRaffle(raffle_1_creator, splMint, { spl: {} });

        // warp time to activation
        const old = Number(context.clock.unixTimestamp);
        context.setClock({
            unixTimestamp: old + 5000,
            slot: context.clock.slot + 100,
        });

        await activateRaffle(program, rafflePdaAddr, raffleId, raffle_admin);

        const balBefore = await getSolBalance(raffle_1_creator.publicKey);

        await cancelRaffle(
            program,
            rafflePdaAddr,
            raffleId,
            raffle_1_creator,
            raffle_admin,
            splMint,
            prizeEscrow,
            creatorPrizeAta,
        );

        const balAfter = await getSolBalance(raffle_1_creator.publicKey);
        assert.ok(balAfter > balBefore);
    });

    // ----------------------------------------------------
    // INVALID — WRONG ADMIN SIGNER
    // ----------------------------------------------------
    it("fails when wrong admin signs", async () => {
        const splMint = await createSplMint();
        const { raffleId, rafflePdaAddr, prizeEscrow, creatorPrizeAta } =
            await makeRaffle(raffle_1_creator, splMint, { sol: {} });

        await assert.rejects(
            cancelRaffle(
                program,
                rafflePdaAddr,
                raffleId,
                raffle_1_creator,
                raffle_2_creator, // wrong admin
                splMint,
                prizeEscrow,
                creatorPrizeAta,
            ),
        );
    });

    // ----------------------------------------------------
    // INVALID — WRONG CREATOR SIGNER
    // ----------------------------------------------------
    it("fails when wrong creator signs", async () => {
        const splMint = await createSplMint();
        const { raffleId, rafflePdaAddr, prizeEscrow, creatorPrizeAta } =
            await makeRaffle(raffle_1_creator, splMint, { sol: {} });

        await assert.rejects(
            cancelRaffle(
                program,
                rafflePdaAddr,
                raffleId,
                raffle_2_creator, // not original creator
                raffle_admin,
                splMint,
                prizeEscrow,
                creatorPrizeAta,
            ),
        );
    });

    // ----------------------------------------------------
    // INVALID — FIRST BUYER ALREADY PURCHASED TICKETS
    // ----------------------------------------------------
    it("fails if tickets already sold", async () => {
        const splMint = await createSplMint();
        const { raffleId, rafflePdaAddr, prizeEscrow, creatorPrizeAta } =
            await makeRaffle(raffle_1_creator, splMint, { spl: {} });

        // manually mutate tickets_sold = 1 (simulate buying)
        const raffle = await program.account.raffle.fetch(rafflePdaAddr);
        raffle.ticketsSold = 1;
        await context.setAccount(rafflePdaAddr, {
            lamports: BigInt(await getSolBalance(rafflePdaAddr)),
            owner: program.programId,
            executable: false,
            data: program.coder.accounts.encode("raffle", raffle),
        });

        await assert.rejects(
            cancelRaffle(
                program,
                rafflePdaAddr,
                raffleId,
                raffle_1_creator,
                raffle_admin,
                splMint,
                prizeEscrow,
                creatorPrizeAta,
            ),
        );
    });

    // ----------------------------------------------------
    // INVALID — CANCEL AGAIN AFTER CANCELLED
    // ----------------------------------------------------
    it("fails cancelling twice", async () => {
        const splMint = await createSplMint();
        const { raffleId, rafflePdaAddr, prizeEscrow, creatorPrizeAta } =
            await makeRaffle(raffle_1_creator, splMint, { sol: {} });

        await cancelRaffle(
            program,
            rafflePdaAddr,
            raffleId,
            raffle_1_creator,
            raffle_admin,
            splMint,
            prizeEscrow,
            creatorPrizeAta,
        );

        await assert.rejects(
            cancelRaffle(
                program,
                rafflePdaAddr,
                raffleId,
                raffle_1_creator,
                raffle_admin,
                splMint,
                prizeEscrow,
                creatorPrizeAta,
            ),
        );
    });

    // ----------------------------------------------------
    // INVALID — CANCEL WHEN ENDED
    // ----------------------------------------------------
    it("fails cancel after raffle ended", async () => {
        const splMint = await createSplMint();
        const { raffleId, rafflePdaAddr, prizeEscrow, creatorPrizeAta } =
            await makeRaffle(raffle_1_creator, splMint, { spl: {} });

        // warp beyond end time
        const old = Number(context.clock.unixTimestamp);
        context.setClock({
            unixTimestamp: old + 500000,
            slot: context.clock.slot + 100,
        });

        // mutate status to FailedEnded
        const raffle = await program.account.raffle.fetch(rafflePdaAddr);
        raffle.status = { failedEnded: {} };
        await context.setAccount(rafflePdaAddr, {
            lamports: BigInt(await getSolBalance(rafflePdaAddr)),
            owner: program.programId,
            executable: false,
            data: program.coder.accounts.encode("raffle", raffle),
        });

        await assert.rejects(
            cancelRaffle(
                program,
                rafflePdaAddr,
                raffleId,
                raffle_1_creator,
                raffle_admin,
                splMint,
                prizeEscrow,
                creatorPrizeAta,
            ),
        );
    });
});
