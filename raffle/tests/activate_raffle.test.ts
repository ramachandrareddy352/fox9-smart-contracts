// tests/activate_raffle.test.ts
import assert from "assert";
import * as anchor from "@coral-xyz/anchor";
import { Clock, startAnchor } from "solana-bankrun";
import { BankrunProvider } from "anchor-bankrun";
import { Raffle } from "../target/types/raffle";
import {
    createRaffleConfig,
    createRaffle,
    createSplMint,
    buildCreateRaffleAccounts,
    activateRaffle,
} from "./helpers";
import {
    setProgram,
    setProvider,
    getProgram,
    getProvider,
    raffle_owner,
    raffle_admin,
    raffle_1_creator,
    raffleConfigPda,
    rafflePda,
} from "./values";

describe("Activate Raffle - Bankrun", () => {
    let context: any;
    let provider: BankrunProvider;

    before(async () => {
        context = await startAnchor("", [], []);
        provider = new BankrunProvider(context);
        anchor.setProvider(provider);
        const client = context.banksClient;

        const program = anchor.workspace.Raffle as anchor.Program<Raffle>;
        setProgram(program);
        setProvider(provider);

        // Fund keypairs
        await context.setAccount(raffle_owner.publicKey, {
            lamports: 10_000_000_000,
            owner: anchor.web3.SystemProgram.programId,
            data: Buffer.alloc(0),
            executable: false,
        });
        await context.setAccount(raffle_1_creator.publicKey, {
            lamports: 50_000_000_000,
            owner: anchor.web3.SystemProgram.programId,
            data: Buffer.alloc(0),
            executable: false,
        });

        await createRaffleConfig(
            program,
            raffle_owner,
            raffle_admin.publicKey,
            {
                creationFeeLamports: 100_000_000,
                ticketFeeBps: 500,
                minPeriod: 3600,
                maxPeriod: 24 * 3600,
            }
        );

        const ticketMint = await createSplMint(9);
        const prizeMint = await createSplMint(9);

        const config = await program.account.raffleConfig.fetch(raffleConfigPda());
        const raffleId = config.raffleCount;
        const rafflePdaAddr = rafflePda(raffleId);

        const { ticketEscrow, prizeEscrow, creatorPrizeAta } =
            await buildCreateRaffleAccounts(rafflePdaAddr, raffle_1_creator, ticketMint, prizeMint);


        const nowClock = await client.getClock();
        const now = Number(nowClock.unixTimestamp);
        console.log("now => ", now)

        await createRaffle(
            program,
            {
                startTime: now + 3600,
                endTime: now + 10000,
                totalTickets: 10,
                ticketPrice: 100_000_000,
                isTicketSol: true,
                maxPct: 30,
                prizeType: { sol: {} } as any,
                prizeAmount: 1_000_000_000,
                numWinners: 1,
                winShares: [100],
                unique: false,
                autoStart: false,
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
    });

    it("activates raffle after start time", async () => {
        const program = getProgram();
        const client = context.banksClient;

        const raffleId = 1;
        const rafflePdaAddr = rafflePda(raffleId);


        // fails when start time is not reached
        await assert.rejects(
            activateRaffle(program, rafflePdaAddr, raffleId, raffle_admin)
        );

        // Warp time forward
        const nowClock = await client.getClock();
        const newTime = Number(nowClock.unixTimestamp) + 4000;
        console.log("newTime => ", newTime)

        context.setClock(
            new Clock(
                nowClock.slot,
                nowClock.epochStartTimestamp,
                nowClock.epoch,
                nowClock.leaderScheduleEpoch,
                BigInt(newTime),
            ),
        );

        // fails when wrong rafle admin calls the function
        await assert.rejects(
            activateRaffle(program, rafflePdaAddr, raffleId, raffle_1_creator)
        );


        // fails when raffle is paused
        // await program.methods
        //     .updatePauseAndUnpause(2)
        //     .accounts({
        //         raffleConfig: raffleConfigPda(),
        //         raffleOwner: raffle_owner.publicKey,
        //     })
        //     .signers([raffle_owner])
        //     .rpc();
        // await assert.rejects(
        //     activateRaffle(program, rafflePdaAddr, raffleId, raffle_admin)
        // );

        // success: activatd correctely
        await activateRaffle(program, rafflePdaAddr, raffleId, raffle_admin);

        const raffle = await program.account.raffle.fetch(rafflePdaAddr);
        assert.deepEqual(raffle.status, { active: {} });

        // after activating again it fails
        await assert.rejects(
            activateRaffle(program, rafflePdaAddr, raffleId, raffle_admin)
        );
    });
});