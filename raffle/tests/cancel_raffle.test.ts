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
    buildCreateRaffleAccounts,
    getTokenBalance,
    mintTokens,
    buyTickets,
    createAta
} from "./helpers";
import {
    raffle_owner,
    raffle_admin,
    raffle_1_creator,
    raffle_2_creator,
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
import { SystemProgram } from "@solana/web3.js";

describe("Cancel Raffle", () => {
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

        await mintTokens(prizeMint, creatorPrizeAta, 100_000_000_000);

        const client = context.banksClient;
        const nowClock = await client.getClock();
        const now = Number(nowClock.unixTimestamp);
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

        const configBalanace = await getSolBalance(raffleConfigPda());
        console.log("configBalanace => ", configBalanace)

        await program.methods.withdrawSolFees(new anchor.BN(90_000_000))
            .accounts({
                raffleConfig: raffleConfigPda(),
                owner: raffle_owner.publicKey,
                receiver: raffle_admin.publicKey,
                systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([raffle_owner])
            .rpc();

        const configBalanaceAfter = await getSolBalance(raffle_admin.publicKey);
        console.log("configBalanaceAfter withdraw => ", configBalanaceAfter)
    });

    // it("cancels active SPL raffle", async () => {
    //     const splMint = await createSplMint();
    //     const { raffleId, rafflePdaAddr, prizeEscrow, creatorPrizeAta } =
    //         await makeRaffle(raffle_1_creator, splMint, { spl: {} });

    //     // warp time to activation
    //     const client = context.banksClient;
    //     const nowClock = await client.getClock();
    //     const newTime = Number(nowClock.unixTimestamp) + 400;
    //     console.log("newTime => ", newTime)

    //     context.setClock(
    //         new Clock(
    //             nowClock.slot,
    //             nowClock.epochStartTimestamp,
    //             nowClock.epoch,
    //             nowClock.leaderScheduleEpoch,
    //             BigInt(newTime),
    //         ),
    //     );

    //     await activateRaffle(program, rafflePdaAddr, raffleId, raffle_admin);

    //     const balBefore = await getTokenBalance(creatorPrizeAta);
    //     console.log("balBefore => ", balBefore)

    //     await cancelRaffle(
    //         program,
    //         rafflePdaAddr,
    //         raffleId,
    //         raffle_1_creator,
    //         raffle_admin,
    //         splMint,
    //         prizeEscrow,
    //         creatorPrizeAta,
    //     );

    //     const balAfter = await getTokenBalance(creatorPrizeAta);
    //     console.log("balAfter => ", balAfter)
    //     assert.ok(balAfter > balBefore);

    //     // after raffle is cancelled the rent is sent to Creator and account is closed and we get `AccountNotInitialized`
    //     await assert.rejects(
    //         cancelRaffle(
    //             program,
    //             rafflePdaAddr,
    //             raffleId,
    //             raffle_1_creator,
    //             raffle_admin,
    //             splMint,
    //             prizeEscrow,
    //             creatorPrizeAta,
    //         )
    //     );
    // });

    // it("fails when wrong admin signs", async () => {
    //     const splMint = await createSplMint();
    //     const { raffleId, rafflePdaAddr, prizeEscrow, creatorPrizeAta } =
    //         await makeRaffle(raffle_1_creator, splMint, { sol: {} });

    //     await assert.rejects(
    //         cancelRaffle(
    //             program,
    //             rafflePdaAddr,
    //             raffleId,
    //             raffle_1_creator,
    //             raffle_2_creator, // wrong admin
    //             splMint,
    //             prizeEscrow,
    //             creatorPrizeAta,
    //         )
    //     );
    // });

    // it("fails when wrong creator signs", async () => {
    //     const splMint = await createSplMint();
    //     const { raffleId, rafflePdaAddr, prizeEscrow, creatorPrizeAta } =
    //         await makeRaffle(raffle_1_creator, splMint, { sol: {} });

    //     await assert.rejects(
    //         cancelRaffle(
    //             program,
    //             rafflePdaAddr,
    //             raffleId,
    //             raffle_2_creator, // not original creator
    //             raffle_admin,
    //             splMint,
    //             prizeEscrow,
    //             creatorPrizeAta,
    //         ),
    //     );
    // });

    // it("fails if tickets already sold", async () => {
    //     const splMint = await createSplMint();
    //     const { raffleId, rafflePdaAddr, prizeEscrow, creatorPrizeAta } =
    //         await makeRaffle(raffle_1_creator, splMint, { sol: {} });

    //     // manually mutate tickets_sold = 1 (simulate buying)
    //     const buyer = anchor.web3.Keypair.generate();
    //     const buyerTicketAta = await createAta(splMint, buyer.publicKey);

    //     await context.setAccount(buyer.publicKey, {
    //         lamports: 20_000_000_000,
    //         owner: anchor.web3.SystemProgram.programId,
    //         executable: false,
    //         data: Buffer.alloc(0),
    //     });

    //     // warp time to activation
    //     const client = context.banksClient;
    //     const nowClock = await client.getClock();
    //     const newTime = Number(nowClock.unixTimestamp) + 400;
    //     console.log("newTime => ", newTime)

    //     context.setClock(
    //         new Clock(
    //             nowClock.slot,
    //             nowClock.epochStartTimestamp,
    //             nowClock.epoch,
    //             nowClock.leaderScheduleEpoch,
    //             BigInt(newTime),
    //         ),
    //     );

    //     await activateRaffle(program, rafflePdaAddr, raffleId, raffle_admin);

    //     await buyTickets(program, rafflePdaAddr, raffleId, buyer, 1, splMint, creatorPrizeAta, buyerTicketAta, raffle_admin);

    //     await assert.rejects(
    //         cancelRaffle(
    //             program,
    //             rafflePdaAddr,
    //             raffleId,
    //             raffle_1_creator,
    //             raffle_admin,
    //             splMint,
    //             prizeEscrow,
    //             creatorPrizeAta,
    //         )
    //     );
    // });
});
