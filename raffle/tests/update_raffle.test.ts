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
    updateRaffleTicketing,
    updateRaffleTime,
    updateRaffleWinners,
    buyTickets,
    createNftMint,
    mintTokensToAta,
    createAta,
} from "./helpers";
import * as values from "./values";

describe("Update Raffle states data", () => {
    let cfg, raffleId, raffleId2, rafflePda, rafflePda2;
    let ticketMint, prizeMint;
    let ticketEscrow, prizeEscrow, ticketEscrow2, prizeEscrow2, creatorPrizeAta;
    let slot, now, end;

    before(async () => {
        // fund the wallets
        await transferSol(values.provider.wallet.payer, values.raffle_owner.publicKey, 1_000_000_000);
        await transferSol(values.provider.wallet.payer, values.raffle_1_creator.publicKey, 100_000_000_000);

        await createRaffleConfig(
            values.program,
            values.raffleConfigPda(),
            values.raffle_owner,
            values.raffle_admin.publicKey,
            {
                creationFeeLamports: values.creation_fee_lamports,
                ticketFeeBps: values.ticket_fee_bps,
                minPeriod: values.minimum_raffle_period,
                maxPeriod: values.maximum_raffle_period,
            }
        );

        cfg = await values.program.account.raffleConfig.fetch(values.raffleConfigPda());
        raffleId = cfg.raffleCount;
        rafflePda = values.rafflePda(raffleId);

        raffleId2 = cfg.raffleCount + 1;
        rafflePda2 = values.rafflePda(raffleId2);

        ticketMint = await createSplMint(values.provider, 9);
        prizeMint = await createSplMint(values.provider, 9);

        ({
            ticketEscrow,
            prizeEscrow,
            creatorPrizeAta
        } = await buildCreateRaffleAccounts(
            values.provider,
            rafflePda,
            values.raffle_1_creator,
            {
                ticketMint,
                prizeMint,
            }
        ));

        ({
            ticketEscrow: ticketEscrow2,
            prizeEscrow: prizeEscrow2,
            creatorPrizeAta
        } = await buildCreateRaffleAccounts(
            values.provider,
            rafflePda2,
            values.raffle_1_creator,
            {
                ticketMint,
                prizeMint,
            }
        ));

        slot = await values.program.provider.connection.getSlot();
        now = await values.program.provider.connection.getBlockTime(slot);
        end = now + 4000;

        // Create raffle-1 with SOL prize & SOL tickets and start the raffle
        await createRaffle(
            values.program,
            {
                startTime: now,
                endTime: end,
                totalTickets: 10,
                ticketPrice: 200_000_000, // 0.2 SOL
                isTicketSol: true,
                maxPct: 20,
                prizeType: { sol: {} },
                prizeAmount: 1_000_000_000, // 1 SOL
                numWinners: 2,
                winShares: [60, 40],
                unique: true,
                autoStart: true,
            },
            {
                raffleConfig: values.raffleConfigPda(),
                rafflePda,
                creator: values.raffle_1_creator,
                raffleAdmin: values.raffle_admin,
                ticketMint,
                prizeMint,
                ticketEscrow,
                prizeEscrow,
                creatorPrizeAta,
            }
        );

        const raffle1 = await values.program.account.raffle.fetch(rafflePda);
        assert.deepEqual(raffle1.status, { active: {} });

        // Create raffle-1 with SOL prize & SOL tickets and start time in feature the raffle
        await createRaffle(
            values.program,
            {
                startTime: now + 100,
                endTime: end,
                totalTickets: 10,
                ticketPrice: 200_000_000, // 0.2 SOL
                isTicketSol: true,
                maxPct: 20,
                prizeType: { sol: {} },
                prizeAmount: 1_000_000_000, // 1 SOL
                numWinners: 2,
                winShares: [60, 40],
                unique: true,
                autoStart: false,
            },
            {
                raffleConfig: values.raffleConfigPda(),
                rafflePda: rafflePda2,
                creator: values.raffle_1_creator,
                raffleAdmin: values.raffle_admin,
                ticketMint,
                prizeMint,
                ticketEscrow: ticketEscrow2,
                prizeEscrow: prizeEscrow2,
                creatorPrizeAta,
            }
        );

        const raffle2 = await values.program.account.raffle.fetch(rafflePda2);
        assert.deepEqual(raffle2.status, { initialized: {} });
    });

    // it("updates raffle time (start and end)", async () => {
    //     const newStart = now + 7200;   // 2 hours from now
    //     const newEnd = newStart + 10800; // 3 hours duration

    //     // fails when the affle is already started
    //     await assert.rejects(
    //         updateRaffleTime(
    //             values.program,
    //             values.raffleConfigPda(),
    //             rafflePda,
    //             raffleId,
    //             newStart,
    //             newEnd,
    //             values.raffle_1_creator,
    //             values.raffle_admin
    //         )
    //     );

    //     // fails when the start time is <= now
    //     await assert.rejects(
    //         updateRaffleTime(
    //             values.program,
    //             values.raffleConfigPda(),
    //             rafflePda2,
    //             raffleId2,
    //             now,
    //             newEnd,
    //             values.raffle_1_creator,
    //             values.raffle_admin
    //         )
    //     );


    //     // fails when the new start time >= new end time
    //     await assert.rejects(
    //         updateRaffleTime(
    //             values.program,
    //             values.raffleConfigPda(),
    //             rafflePda2,
    //             raffleId2,
    //             newStart,
    //             newEnd - 10801,
    //             values.raffle_1_creator,
    //             values.raffle_admin

    //         )
    //     );

    //     // fails when the wrong raffle Id is given
    //     await assert.rejects(
    //         updateRaffleTime(
    //             values.program,
    //             values.raffleConfigPda(),
    //             rafflePda2,
    //             raffleId,
    //             newStart,
    //             newEnd,
    //             values.raffle_1_creator,
    //             values.raffle_admin
    //         )
    //     );

    //     // fails when the wrong raffle creator try to update
    //     await assert.rejects(
    //         updateRaffleTime(
    //             values.program,
    //             values.raffleConfigPda(),
    //             rafflePda2,
    //             raffleId2,
    //             newStart,
    //             newEnd,
    //             values.raffle_2_creator,
    //             values.raffle_admin
    //         )
    //     );

    //     // fails when the wrong raffle admin signer
    //     await assert.rejects(
    //         updateRaffleTime(
    //             values.program,
    //             values.raffleConfigPda(),
    //             rafflePda2,
    //             raffleId2,
    //             newStart,
    //             newEnd,
    //             values.raffle_1_creator,
    //             values.raffle_owner
    //         )
    //     );

    //     // successfully updated when all the data is correct
    //     await updateRaffleTime(
    //         values.program,
    //         values.raffleConfigPda(),
    //         rafflePda2,
    //         raffleId2,
    //         newStart,
    //         newEnd,
    //         values.raffle_1_creator,
    //         values.raffle_admin
    //     );

    //     const raffle2 = await values.program.account.raffle.fetch(rafflePda2);
    //     assert.equal(raffle2.startTime.toNumber(), newStart);
    //     assert.equal(raffle2.endTime.toNumber(), newEnd);
    //     assert.deepEqual(raffle2.status, { initialized: {} });

    //     // pause the update and try to update again
    //     await values.program.methods
    //         .updatePauseAndUnpause(128)
    //         .accounts({
    //             raffleConfig: values.raffleConfigPda(),
    //             raffleOwner: values.raffle_owner.publicKey,
    //         })
    //         .signers([values.raffle_owner])
    //         .rpc();

    //     // fails when updation is paused
    //     await updateRaffleTime(
    //         values.program,
    //         values.raffleConfigPda(),
    //         rafflePda2,
    //         raffleId2,
    //         newStart + 100,
    //         newEnd,
    //         values.raffle_1_creator,
    //         values.raffle_admin
    //     );
    // });

    // it("updates raffle ticketing (total tickets, price, max %)", async () => {
    //     await updateRaffleTicketing(
    //         values.program,
    //         values.raffleConfigPda(),
    //         rafflePda,
    //         raffleId,
    //         10,              // new total tickets
    //         100_000_000,      // 0.1 SOL
    //         30,               // max 30%
    //         values.raffle_1_creator,
    //         values.raffle_admin
    //     );

    //     const raffle = await values.program.account.raffle.fetch(rafflePda);
    //     assert.equal(raffle.totalTickets, 10);
    //     assert.equal(raffle.ticketPrice.toNumber(), 100_000_000);
    //     assert.equal(raffle.maxPerWalletPct, 30);

    //     // update the state after buying a ticket here
    // });

    // it("fails to update ticketing after tickets are sold", async () => {

    //     const buyer = new anchor.web3.Keypair();
    //     await transferSol(values.provider.wallet.payer, buyer.publicKey, 1_000_000_000);

    //     await buyTickets(
    //         values.program,
    //         values.raffleConfigPda(),
    //         rafflePda,
    //         raffleId,
    //         buyer,
    //         1,
    //         ticketMint,
    //         ticketEscrow,
    //         creatorPrizeAta,
    //         values.raffle_admin
    //     )

    //     await assert.rejects(
    //         updateRaffleTicketing(
    //             values.program,
    //             values.raffleConfigPda(),
    //             rafflePda,
    //             raffleId,
    //             300,
    //             400_000_000,
    //             40,
    //             values.raffle_1_creator,
    //             values.raffle_admin
    //         )
    //     );
    // });

    // it("updates winner shares and uniqueness", async () => {
    //     await updateRaffleWinners(
    //         values.program,
    //         values.raffleConfigPda(),
    //         rafflePda,
    //         raffleId,
    //         [70, 30],         // new shares
    //         false,            // not unique
    //         values.raffle_1_creator,
    //         values.raffle_admin
    //     );

    //     const raffle = await values.program.account.raffle.fetch(rafflePda);
    //     assert.deepEqual(raffle.winShares, Buffer.from([70, 30]));
    //     assert.equal(raffle.isUniqueWinners, false);
    // });

    it("Fails when we try to update for the NFT prize Raffle", async () => {

        const rafflePda3 = values.rafflePda(3);

        ticketMint = await createNftMint(values.provider);
        prizeMint = await createNftMint(values.provider);

        ({
            ticketEscrow,
            prizeEscrow,
            creatorPrizeAta
        } = await buildCreateRaffleAccounts(
            values.provider,
            rafflePda3,
            values.raffle_1_creator,
            {
                ticketMint,
                prizeMint,
            }
        ));

        await mintTokensToAta(
            values.provider,
            prizeMint,
            creatorPrizeAta,
            1
        );

        await createRaffle(
            values.program,
            {
                startTime: now,
                endTime: end,
                totalTickets: 10,
                ticketPrice: 200_000_000, // 0.2 SOL
                isTicketSol: true,
                maxPct: 20,
                prizeType: { nft: {} },
                prizeAmount: 1_000_000_000, // 1 SOL
                numWinners: 2,
                winShares: [60, 40],  // all are rewritted
                unique: true,
                autoStart: true,
            },
            {
                raffleConfig: values.raffleConfigPda(),
                rafflePda: rafflePda3,
                creator: values.raffle_1_creator,
                raffleAdmin: values.raffle_admin,
                ticketMint,
                prizeMint,
                ticketEscrow,
                prizeEscrow,
                creatorPrizeAta,
            }
        );

        await assert.rejects(
            updateRaffleWinners(
                values.program,
                values.raffleConfigPda(),
                rafflePda3,
                3,
                [100],         // new shares
                false,            // not unique
                values.raffle_1_creator,
                values.raffle_admin
            )
        );
    });
});