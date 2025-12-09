import assert from "assert";
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Raffle } from "../target/types/raffle";
import {
    createRaffleConfig,
    createRaffle,
    transferSol,
    buildCreateRaffleAccounts,
    createSplMint,
    warpTime,
} from "./helpers";
import * as values from "./values";

// Helper for activate_raffle
export async function activateRaffle(
    program: anchor.Program<Raffle>,
    rafflePda: anchor.web3.PublicKey,
    raffleId: number,
    admin: anchor.web3.Keypair
) {
    await program.methods
        .activateRaffle(raffleId)
        .accounts({
            raffleConfig: values.raffleConfigPda(),
            raffle: rafflePda,
            raffleAdmin: admin.publicKey,
        })
        .signers([admin])
        .rpc();

    // Wait for local validator
    await new Promise((r) => setTimeout(r, 1000));
}

describe("Activate Raffle - Full Test Suite", () => {
    const program = values.program as Program<Raffle>;
    const provider = values.provider;

    let rafflePdaActive: anchor.web3.PublicKey;
    let rafflePdaInitialized: anchor.web3.PublicKey;
    let raffleIdActive: number;
    let raffleIdInitialized: number;

    let ticketMint: anchor.web3.PublicKey;
    let prizeMint: anchor.web3.PublicKey;
    let ticketEscrow: anchor.web3.PublicKey;
    let prizeEscrow: anchor.web3.PublicKey;
    let creatorPrizeAta: anchor.web3.PublicKey;

    let now: number;

    before(async () => {
        // Fund wallets
        await transferSol(provider.wallet.payer, values.raffle_owner.publicKey, 5_000_000_000);
        await transferSol(provider.wallet.payer, values.raffle_1_creator.publicKey, 50_000_000_000);

        // Create config
        await createRaffleConfig(
            program,
            values.raffleConfigPda(),
            values.raffle_owner,
            values.raffle_admin.publicKey,
            {
                creationFeeLamports: 100_000_000,
                ticketFeeBps: 500,
                minPeriod: 60,
                maxPeriod: 30 * 24 * 3600,
            }
        );

        // Create mints
        ticketMint = await createSplMint(provider, 9);
        prizeMint = await createSplMint(provider, 9);

        const config = await program.account.raffleConfig.fetch(values.raffleConfigPda());

        // === Raffle 1: Already Active (autoStart: true) ===
        raffleIdActive = config.raffleCount;
        rafflePdaActive = values.rafflePda(raffleIdActive);

        ({
            ticketEscrow,
            prizeEscrow,
            creatorPrizeAta,
        } = await buildCreateRaffleAccounts(provider, rafflePdaActive, values.raffle_1_creator, {
            ticketMint,
            prizeMint,
        }));

        const slot1 = await provider.connection.getSlot();
        now = await provider.connection.getBlockTime(slot1);

        await createRaffle(
            program,
            {
                startTime: now - 100,           // already started
                endTime: now + 3600,
                totalTickets: 100,
                ticketPrice: 100_000_000,
                isTicketSol: true,
                maxPct: 25,
                prizeType: { sol: {} } as any,
                prizeAmount: 1_000_000_000,
                numWinners: 1,
                winShares: [100],
                unique: true,
                autoStart: true,
            },
            {
                raffleConfig: values.raffleConfigPda(),
                rafflePda: rafflePdaActive,
                creator: values.raffle_1_creator,
                raffleAdmin: values.raffle_admin,
                ticketMint,
                prizeMint,
                ticketEscrow,
                prizeEscrow,
                creatorPrizeAta,
            }
        );

        // === Raffle 2: Initialized, start_time in future ===
        const config2 = await program.account.raffleConfig.fetch(values.raffleConfigPda());
        raffleIdInitialized = config2.raffleCount;
        rafflePdaInitialized = values.rafflePda(raffleIdInitialized);

        ({
            ticketEscrow,
            prizeEscrow,
            creatorPrizeAta,
        } = await buildCreateRaffleAccounts(provider, rafflePdaInitialized, values.raffle_1_creator, {
            ticketMint,
            prizeMint,
        }));

        await createRaffle(
            program,
            {
                startTime: now + 3600,            // 1 hour from now
                endTime: now + 7200,
                totalTickets: 50,
                ticketPrice: 200_000_000,
                isTicketSol: true,
                maxPct: 30,
                prizeType: { sol: {} } as any,
                prizeAmount: 2_000_000_000,
                numWinners: 3,
                winShares: [50, 30, 20],
                unique: false,
                autoStart: false,
            },
            {
                raffleConfig: values.raffleConfigPda(),
                rafflePda: rafflePdaInitialized,
                creator: values.raffle_1_creator,
                raffleAdmin: values.raffle_admin,
                ticketMint,
                prizeMint,
                ticketEscrow,
                prizeEscrow,
                creatorPrizeAta,
            }
        );

        // Wait a bit
        await new Promise((r) => setTimeout(r, 1000));
    });

    it("SUCCESS: Activates raffle when start_time has passed", async () => {
        // Warp time forward past start_time
        await warpTime(provider, 4000); // +4000 seconds

        await activateRaffle(
            program,
            rafflePdaInitialized,
            raffleIdInitialized,
            values.raffle_admin
        );

        const raffle = await program.account.raffle.fetch(rafflePdaInitialized);
        assert.deepEqual(raffle.status, { active: {} });
    });

    it("FAILS: Cannot activate raffle that is already Active", async () => {
        await assert.rejects(
            activateRaffle(
                program,
                rafflePdaActive,
                raffleIdActive,
                values.raffle_admin
            ),
            (err: any) => {
                return err.logs?.some((log: string) =>
                    log.includes("StateShouldBeInInitialized")
                );
            }
        );
    });

    it("FAILS: Cannot activate if current time < start_time", async () => {
        // Create a new raffle with far future start time
        const config = await program.account.raffleConfig.fetch(values.raffleConfigPda());
        const newRaffleId = config.raffleCount + 1;
        const newPda = values.rafflePda(newRaffleId);

        await buildCreateRaffleAccounts(provider, newPda, values.raffle_1_creator, {
            ticketMint,
            prizeMint,
        });

        const farFuture = Math.floor(Date.now() / 1000) + 86400; // +1 day

        await createRaffle(
            program,
            {
                startTime: farFuture,
                endTime: farFuture + 3600,
                totalTickets: 10,
                ticketPrice: 100_000_000,
                isTicketSol: true,
                maxPct: 100,
                prizeType: { sol: {} } as any,
                prizeAmount: 500_000_000,
                numWinners: 1,
                winShares: [100],
                unique: true,
                autoStart: false,
            },
            {
                raffleConfig: values.raffleConfigPda(),
                rafflePda: newPda,
                creator: values.raffle_1_creator,
                raffleAdmin: values.raffle_admin,
                ticketMint,
                prizeMint: prizeMint,
                ticketEscrow,
                prizeEscrow,
                creatorPrizeAta,
            }
        );

        await new Promise((r) => setTimeout(r, 1000));

        await assert.rejects(
            activateRaffle(program, newPda, newRaffleId, values.raffle_admin),
            (err: any) => {
                return err.logs?.some((log: string) =>
                    log.includes("StartTimeNotReached")
                );
            }
        );
    });

    it("FAILS: Wrong raffle_admin signer", async () => {
        await assert.rejects(
            program.methods
                .activateRaffle(raffleIdInitialized)
                .accounts({
                    raffleConfig: values.raffleConfigPda(),
                    raffle: rafflePdaInitialized,
                    raffleAdmin: values.raffle_owner.publicKey, // wrong!
                })
                .signers([values.raffle_owner])
                .rpc(),
            (err: any) => err.logs?.some((l: string) => l.includes("InvalidRaffleAdmin"))
        );
    });

    it("FAILS: Wrong raffle ID in instruction", async () => {
        await warpTime(provider, 1000); // ensure time passed

        await assert.rejects(
            activateRaffle(
                program,
                rafflePdaInitialized,
                999999, // wrong ID
                values.raffle_admin
            ),
            (err: any) => {
                return err.logs?.some((log: string) =>
                    log.includes("InvalidRaffleId")
                );
            }
        );
    });

    it("FAILS: When ACTIVATE_RAFFLE_PAUSE is enabled", async () => {
        // Pause the function (assuming bit 7 = ACTIVATE_RAFFLE_PAUSE)
        await program.methods
            .updatePauseAndUnpause(1 << 7) // set bit 7
            .accounts({
                raffleConfig: values.raffleConfigPda(),
                raffleOwner: values.raffle_owner.publicKey,
            })
            .signers([values.raffle_owner])
            .rpc();

        await new Promise((r) => setTimeout(r, 800));

        await assert.rejects(
            activateRaffle(
                program,
                rafflePdaInitialized,
                raffleIdInitialized,
                values.raffle_admin
            ),
            (err: any) => err.logs?.some((l: string) => l.includes("FunctionPaused"))
        );

        // Unpause for future tests
        await program.methods
            .updatePauseAndUnpause(0)
            .accounts({
                raffleConfig: values.raffleConfigPda(),
                raffleOwner: values.raffle_owner.publicKey,
            })
            .signers([values.raffle_owner])
            .rpc();
    });
});