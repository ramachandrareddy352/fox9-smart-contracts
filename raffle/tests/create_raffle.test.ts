import assert from "assert";
import * as anchor from "@coral-xyz/anchor";
import {
    buildCreateRaffleAccounts,
    createRaffle,
    createRaffleConfig,
    createSplMint,
    transferSol,
    createNftMint,
    createAta,
    mintTokensToAta,
} from "./helpers";
import * as values from "./values";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { SystemProgram } from "@solana/web3.js";

// describe("Create raffle with Invalid data", () => {
//     let cfg, raffleId, rafflePda;
//     let ticketMint, prizeMint;
//     let ticketEscrow, prizeEscrow, creatorPrizeAta;
//     let slot, now, end;

//     before(async () => {
//         await transferSol(values.provider.wallet.payer, values.raffle_owner.publicKey, 1_000_000_000);
//         await transferSol(values.provider.wallet.payer, values.raffle_1_creator.publicKey, 10_000_000_000);

//         await createRaffleConfig(
//             values.program,
//             values.raffleConfigPda(),
//             values.raffle_owner,
//             values.raffle_admin.publicKey,
//             {
//                 creationFeeLamports: values.creation_fee_lamports,
//                 ticketFeeBps: values.ticket_fee_bps,
//                 minPeriod: values.minimum_raffle_period,
//                 maxPeriod: values.maximum_raffle_period,
//             }
//         );

//         cfg = await values.program.account.raffleConfig.fetch(values.raffleConfigPda());
//         raffleId = cfg.raffleCount;
//         rafflePda = values.rafflePda(raffleId);

//         ticketMint = await createSplMint(values.provider, 9);
//         prizeMint = await createSplMint(values.provider, 9);

//         ({
//             ticketEscrow,
//             prizeEscrow,
//             creatorPrizeAta
//         } = await buildCreateRaffleAccounts(
//             values.provider,
//             rafflePda,
//             values.raffle_1_creator,
//             {
//                 ticketMint,
//                 prizeMint,
//             }
//         ));

//         slot = await values.program.provider.connection.getSlot();
//         now = await values.program.provider.connection.getBlockTime(slot);
//         end = now + 3700;
//     });

//     // it("Fails while creating a raffle without admin signer", async () => {
//     //     await assert.rejects(
//     //         values.program.methods
//     //             .createRaffle(
//     //                 new anchor.BN(now),    // i64
//     //                 new anchor.BN(end),      // i64
//     //                 100,                // u16
//     //                 new anchor.BN(200_000_000),  // u64
//     //                 true,                 // bool
//     //                 20,                      // u8
//     //                 { sol: {} },                   // PrizeType enum
//     //                 new anchor.BN(1_000_000_000),  // u64
//     //                 1,                  // u8
//     //                 Buffer.from([100]),                   // Vec<u8>
//     //                 true,                      // bool
//     //                 true                    // bool
//     //             )
//     //             .accounts({
//     //                 raffleConfig: values.raffleConfigPda(),
//     //                 raffle: rafflePda,
//     //                 creator: values.raffle_1_creator.publicKey,
//     //                 raffleAdmin: values.raffle_admin.publicKey,
//     //                 ticketMint: ticketMint,
//     //                 prizeMint: prizeMint,
//     //                 ticketEscrow: ticketEscrow,
//     //                 prizeEscrow: prizeEscrow,
//     //                 creatorPrizeAta: creatorPrizeAta,
//     //                 ticketTokenProgram: TOKEN_PROGRAM_ID,
//     //                 prizeTokenProgram: TOKEN_PROGRAM_ID,
//     //                 systemProgram: SystemProgram.programId,
//     //             })
//     //             .signers([values.raffle_1_creator])    // admin signer is missing
//     //             .rpc()
//     //     );
//     // });

//     // it("Fails while creating a raffle with same raffle admin key but invalid raffle admin signer", async () => {
//     //     await assert.rejects(
//     //         values.program.methods
//     //             .createRaffle(
//     //                 new anchor.BN(now),    // i64
//     //                 new anchor.BN(end),      // i64
//     //                 100,                // u16
//     //                 new anchor.BN(200_000_000),  // u64
//     //                 true,                 // bool
//     //                 20,                      // u8
//     //                 { sol: {} },                   // PrizeType enum
//     //                 new anchor.BN(1_000_000_000),  // u64
//     //                 1,                  // u8
//     //                 Buffer.from([100]),                   // Vec<u8>
//     //                 true,                      // bool
//     //                 true                    // bool
//     //             )
//     //             .accounts({
//     //                 raffleConfig: values.raffleConfigPda(),
//     //                 raffle: rafflePda,
//     //                 creator: values.raffle_1_creator.publicKey,
//     //                 raffleAdmin: values.raffle_admin.publicKey,   
//     //                 ticketMint: ticketMint,
//     //                 prizeMint: prizeMint,
//     //                 ticketEscrow: ticketEscrow,
//     //                 prizeEscrow: prizeEscrow,
//     //                 creatorPrizeAta: creatorPrizeAta,
//     //                 ticketTokenProgram: TOKEN_PROGRAM_ID,
//     //                 prizeTokenProgram: TOKEN_PROGRAM_ID,
//     //                 systemProgram: SystemProgram.programId,
//     //             })
//     //             .signers([values.raffle_1_creator, values.raffle_owner])    // admin signer is missing
//     //             .rpc()
//     //     );
//     // });

//     // it("Fails while creating a raffle with invalid Raffle ID", async () => {
//     //     await assert.rejects(
//     //         values.program.methods
//     //             .createRaffle(
//     //                 new anchor.BN(now),    // i64
//     //                 new anchor.BN(end),      // i64
//     //                 100,                // u16
//     //                 new anchor.BN(200_000_000),  // u64
//     //                 true,                 // bool
//     //                 20,                      // u8
//     //                 { sol: {} },                   // PrizeType enum
//     //                 new anchor.BN(1_000_000_000),  // u64
//     //                 1,                  // u8
//     //                 Buffer.from([100]),                   // Vec<u8>
//     //                 true,                      // bool
//     //                 true                    // bool
//     //             )
//     //             .accounts({
//     //                 raffleConfig: values.raffleConfigPda(),
//     //                 raffle: values.rafflePda(2),
//     //                 creator: values.raffle_1_creator.publicKey,
//     //                 raffleAdmin: values.raffle_admin.publicKey,   
//     //                 ticketMint: ticketMint,
//     //                 prizeMint: prizeMint,
//     //                 ticketEscrow: ticketEscrow,
//     //                 prizeEscrow: prizeEscrow,
//     //                 creatorPrizeAta: creatorPrizeAta,
//     //                 ticketTokenProgram: TOKEN_PROGRAM_ID,
//     //                 prizeTokenProgram: TOKEN_PROGRAM_ID,
//     //                 systemProgram: SystemProgram.programId,
//     //             })
//     //             .signers([values.raffle_1_creator, values.raffle_admin])    // admin signer is missing
//     //             .rpc()
//     //     );
//     // });

//     // it("Fails when the create raffle is paused", async () => {
//     //     await values.program.methods
//     //         .updatePauseAndUnpause(1)
//     //         .accounts({
//     //             raffleConfig: values.raffleConfigPda(),
//     //             raffleOwner: values.raffle_owner.publicKey,
//     //         })
//     //         .signers([values.raffle_owner])
//     //         .rpc();

//     //     await assert.rejects(
//     //         values.program.methods
//     //             .createRaffle(
//     //                 new anchor.BN(now),    // i64
//     //                 new anchor.BN(end),      // i64
//     //                 100,                // u16
//     //                 new anchor.BN(200_000_000),  // u64
//     //                 true,                 // bool
//     //                 20,                      // u8
//     //                 { sol: {} },                   // PrizeType enum
//     //                 new anchor.BN(1_000_000_000),  // u64
//     //                 1,                  // u8
//     //                 Buffer.from([100]),                   // Vec<u8>
//     //                 true,                      // bool
//     //                 true                    // bool
//     //             )
//     //             .accounts({
//     //                 raffleConfig: values.raffleConfigPda(),
//     //                 raffle: rafflePda,
//     //                 creator: values.raffle_1_creator.publicKey,
//     //                 raffleAdmin: values.raffle_admin.publicKey,   
//     //                 ticketMint: ticketMint,
//     //                 prizeMint: prizeMint,
//     //                 ticketEscrow: ticketEscrow,
//     //                 prizeEscrow: prizeEscrow,
//     //                 creatorPrizeAta: creatorPrizeAta,
//     //                 ticketTokenProgram: TOKEN_PROGRAM_ID,
//     //                 prizeTokenProgram: TOKEN_PROGRAM_ID,
//     //                 systemProgram: SystemProgram.programId,
//     //             })
//     //             .signers([values.raffle_1_creator, values.raffle_admin])    // admin signer is missing
//     //             .rpc()
//     //     );
//     // });

//     // it("Fails when the ticket prize is zero", async () => {
//     //     await assert.rejects(
//     //         values.program.methods
//     //             .createRaffle(
//     //                 new anchor.BN(now),    // i64
//     //                 new anchor.BN(end),      // i64
//     //                 100,                // u16
//     //                 new anchor.BN(0),  // u64
//     //                 true,                 // bool
//     //                 20,                      // u8
//     //                 { sol: {} },                   // PrizeType enum
//     //                 new anchor.BN(1_000_000_000),  // u64
//     //                 1,                  // u8
//     //                 Buffer.from([100]),                   // Vec<u8>
//     //                 true,                      // bool
//     //                 true                    // bool
//     //             )
//     //             .accounts({
//     //                 raffleConfig: values.raffleConfigPda(),
//     //                 raffle: rafflePda,
//     //                 creator: values.raffle_1_creator.publicKey,
//     //                 raffleAdmin: values.raffle_admin.publicKey,   
//     //                 ticketMint: ticketMint,
//     //                 prizeMint: prizeMint,
//     //                 ticketEscrow: ticketEscrow,
//     //                 prizeEscrow: prizeEscrow,
//     //                 creatorPrizeAta: creatorPrizeAta,
//     //                 ticketTokenProgram: TOKEN_PROGRAM_ID,
//     //                 prizeTokenProgram: TOKEN_PROGRAM_ID,
//     //                 systemProgram: SystemProgram.programId,
//     //             })
//     //             .signers([values.raffle_1_creator, values.raffle_admin])    // admin signer is missing
//     //             .rpc()
//     //     );
//     // });

//     // it("Fails when total ticket are less that MINIMUM TICKETS[3]", async () => {
//     //     await assert.rejects(
//     //         values.program.methods
//     //             .createRaffle(
//     //                 new anchor.BN(now),    // i64
//     //                 new anchor.BN(end),      // i64
//     //                 2,                // less than min tickets
//     //                 new anchor.BN(200_000_000),  // u64
//     //                 true,                 // bool
//     //                 20,                      // u8
//     //                 { sol: {} },                   // PrizeType enum
//     //                 new anchor.BN(1_000_000_000),  // u64
//     //                 1,                  // u8
//     //                 Buffer.from([100]),                   // Vec<u8>
//     //                 true,                      // bool
//     //                 true                    // bool
//     //             )
//     //             .accounts({
//     //                 raffleConfig: values.raffleConfigPda(),
//     //                 raffle: rafflePda,
//     //                 creator: values.raffle_1_creator.publicKey,
//     //                 raffleAdmin: values.raffle_admin.publicKey,   
//     //                 ticketMint: ticketMint,
//     //                 prizeMint: prizeMint,
//     //                 ticketEscrow: ticketEscrow,
//     //                 prizeEscrow: prizeEscrow,
//     //                 creatorPrizeAta: creatorPrizeAta,
//     //                 ticketTokenProgram: TOKEN_PROGRAM_ID,
//     //                 prizeTokenProgram: TOKEN_PROGRAM_ID,
//     //                 systemProgram: SystemProgram.programId,
//     //             })
//     //             .signers([values.raffle_1_creator, values.raffle_admin])    // admin signer is missing
//     //             .rpc()
//     //     );
//     // });

//     // it("Fails when total ticket are greater that MAXIMUM TICKETS[10,000]", async () => {
//     //     await assert.rejects(
//     //         values.program.methods
//     //             .createRaffle(
//     //                 new anchor.BN(now),    // i64
//     //                 new anchor.BN(end),      // i64
//     //                 20_000,                // greater than max tickets
//     //                 new anchor.BN(200_000_000),  // u64
//     //                 true,                 // bool
//     //                 20,                      // u8
//     //                 { sol: {} },                   // PrizeType enum
//     //                 new anchor.BN(1_000_000_000),  // u64
//     //                 1,                  // u8
//     //                 Buffer.from([100]),                   // Vec<u8>
//     //                 true,                      // bool
//     //                 true                    // bool
//     //             )
//     //             .accounts({
//     //                 raffleConfig: values.raffleConfigPda(),
//     //                 raffle: rafflePda,
//     //                 creator: values.raffle_1_creator.publicKey,
//     //                 raffleAdmin: values.raffle_admin.publicKey,   
//     //                 ticketMint: ticketMint,
//     //                 prizeMint: prizeMint,
//     //                 ticketEscrow: ticketEscrow,
//     //                 prizeEscrow: prizeEscrow,
//     //                 creatorPrizeAta: creatorPrizeAta,
//     //                 ticketTokenProgram: TOKEN_PROGRAM_ID,
//     //                 prizeTokenProgram: TOKEN_PROGRAM_ID,
//     //                 systemProgram: SystemProgram.programId,
//     //             })
//     //             .signers([values.raffle_1_creator, values.raffle_admin])    // admin signer is missing
//     //             .rpc()
//     //     );
//     // });

//     // it("Fails when winners count is greater than 10", async () => {
//     //     await assert.rejects(
//     //         values.program.methods
//     //             .createRaffle(
//     //                 new anchor.BN(now),    // i64
//     //                 new anchor.BN(end),      // i64
//     //                 100,                // greater than max tickets
//     //                 new anchor.BN(200_000_000),  // u64
//     //                 true,                 // bool
//     //                 20,                      // u8
//     //                 { sol: {} },                   // PrizeType enum
//     //                 new anchor.BN(1_000_000_000),  // u64
//     //                 20,                  // u8
//     //                 Buffer.from([5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5]),
//     //                 true,                      // bool
//     //                 true                    // bool
//     //             )
//     //             .accounts({
//     //                 raffleConfig: values.raffleConfigPda(),
//     //                 raffle: rafflePda,
//     //                 creator: values.raffle_1_creator.publicKey,
//     //                 raffleAdmin: values.raffle_admin.publicKey,   
//     //                 ticketMint: ticketMint,
//     //                 prizeMint: prizeMint,
//     //                 ticketEscrow: ticketEscrow,
//     //                 prizeEscrow: prizeEscrow,
//     //                 creatorPrizeAta: creatorPrizeAta,
//     //                 ticketTokenProgram: TOKEN_PROGRAM_ID,
//     //                 prizeTokenProgram: TOKEN_PROGRAM_ID,
//     //                 systemProgram: SystemProgram.programId,
//     //             })
//     //             .signers([values.raffle_1_creator, values.raffle_admin])    // admin signer is missing
//     //             .rpc()
//     //     );
//     // });

//     // it("Fails when prize amount is less than winners count", async () => {
//     //     await assert.rejects(
//     //         values.program.methods
//     //             .createRaffle(
//     //                 new anchor.BN(now),    // start time
//     //                 new anchor.BN(end),      // end time
//     //                 100,                // no.of tickets
//     //                 new anchor.BN(200_000_000),  // ticket amount to pay
//     //                 true,                 // is ticket mint sol
//     //                 20,                      // max per wallet PCT
//     //                 { sol: {} },                   // PrizeType enum
//     //                 new anchor.BN(1),  // prize amount
//     //                 10,                  // total winners
//     //                 Buffer.from([10, 10, 10, 10, 10, 10, 10, 10, 10, 10]),  // winners shares
//     //                 true,                      // is unique winners
//     //                 true                    // start raffle now
//     //             )
//     //             .accounts({
//     //                 raffleConfig: values.raffleConfigPda(),
//     //                 raffle: rafflePda,
//     //                 creator: values.raffle_1_creator.publicKey,
//     //                 raffleAdmin: values.raffle_admin.publicKey,   
//     //                 ticketMint: ticketMint,
//     //                 prizeMint: prizeMint,
//     //                 ticketEscrow: ticketEscrow,
//     //                 prizeEscrow: prizeEscrow,
//     //                 creatorPrizeAta: creatorPrizeAta,
//     //                 ticketTokenProgram: TOKEN_PROGRAM_ID,
//     //                 prizeTokenProgram: TOKEN_PROGRAM_ID,
//     //                 systemProgram: SystemProgram.programId,
//     //             })
//     //             .signers([values.raffle_1_creator, values.raffle_admin])    // admin signer is missing
//     //             .rpc()
//     //     );
//     // });

//     // it("Fails when win shares length is mismatched", async () => {
//     //     await assert.rejects(
//     //         values.program.methods
//     //             .createRaffle(
//     //                 new anchor.BN(now),    // start time
//     //                 new anchor.BN(end),      // end time
//     //                 100,                // no.of tickets
//     //                 new anchor.BN(200_000_000),  // ticket amount to pay
//     //                 true,                 // is ticket mint sol
//     //                 20,                      // max per wallet PCT
//     //                 { sol: {} },                   // PrizeType enum
//     //                 new anchor.BN(1_000_000_000),  // prize amount
//     //                 5,                  // total winners
//     //                 Buffer.from([10, 10, 10, 10, 10, 10, 10, 10, 10, 10]),  // winners shares
//     //                 true,                      // is unique winners
//     //                 true                    // start raffle now
//     //             )
//     //             .accounts({
//     //                 raffleConfig: values.raffleConfigPda(),
//     //                 raffle: rafflePda,
//     //                 creator: values.raffle_1_creator.publicKey,
//     //                 raffleAdmin: values.raffle_admin.publicKey,   
//     //                 ticketMint: ticketMint,
//     //                 prizeMint: prizeMint,
//     //                 ticketEscrow: ticketEscrow,
//     //                 prizeEscrow: prizeEscrow,
//     //                 creatorPrizeAta: creatorPrizeAta,
//     //                 ticketTokenProgram: TOKEN_PROGRAM_ID,
//     //                 prizeTokenProgram: TOKEN_PROGRAM_ID,
//     //                 systemProgram: SystemProgram.programId,
//     //             })
//     //             .signers([values.raffle_1_creator, values.raffle_admin])    // admin signer is missing
//     //             .rpc()
//     //     );
//     // });

//     // it("Fails creator gives win share as zero", async () => {
//     //     await assert.rejects(
//     //         values.program.methods
//     //             .createRaffle(
//     //                 new anchor.BN(now),    // start time
//     //                 new anchor.BN(end),      // end time
//     //                 100,                // no.of tickets
//     //                 new anchor.BN(200_000_000),  // ticket amount to pay
//     //                 true,                 // is ticket mint sol
//     //                 20,                      // max per wallet PCT
//     //                 { sol: {} },                   // PrizeType enum
//     //                 new anchor.BN(1_000_000_000),  // prize amount
//     //                 5,                  // total winners
//     //                 Buffer.from([30, 30, 20, 20, 0]),  // winners shares
//     //                 true,                      // is unique winners
//     //                 true                    // start raffle now
//     //             )
//     //             .accounts({
//     //                 raffleConfig: values.raffleConfigPda(),
//     //                 raffle: rafflePda,
//     //                 creator: values.raffle_1_creator.publicKey,
//     //                 raffleAdmin: values.raffle_admin.publicKey,   
//     //                 ticketMint: ticketMint,
//     //                 prizeMint: prizeMint,
//     //                 ticketEscrow: ticketEscrow,
//     //                 prizeEscrow: prizeEscrow,
//     //                 creatorPrizeAta: creatorPrizeAta,
//     //                 ticketTokenProgram: TOKEN_PROGRAM_ID,
//     //                 prizeTokenProgram: TOKEN_PROGRAM_ID,
//     //                 systemProgram: SystemProgram.programId,
//     //             })
//     //             .signers([values.raffle_1_creator, values.raffle_admin])    // admin signer is missing
//     //             .rpc()
//     //     );
//     // });

//     // it("Fails creator gives win share in not decreasing order", async () => {
//     //     await assert.rejects(
//     //         values.program.methods
//     //             .createRaffle(
//     //                 new anchor.BN(now),    // start time
//     //                 new anchor.BN(end),      // end time
//     //                 100,                // no.of tickets
//     //                 new anchor.BN(200_000_000),  // ticket amount to pay
//     //                 true,                 // is ticket mint sol
//     //                 20,                      // max per wallet PCT
//     //                 { sol: {} },                   // PrizeType enum
//     //                 new anchor.BN(1_000_000_000),  // prize amount
//     //                 5,                  // total winners
//     //                 Buffer.from([20, 30, 20, 20, 10]),  // winners shares
//     //                 true,                      // is unique winners
//     //                 true                    // start raffle now
//     //             )
//     //             .accounts({
//     //                 raffleConfig: values.raffleConfigPda(),
//     //                 raffle: rafflePda,
//     //                 creator: values.raffle_1_creator.publicKey,
//     //                 raffleAdmin: values.raffle_admin.publicKey,   
//     //                 ticketMint: ticketMint,
//     //                 prizeMint: prizeMint,
//     //                 ticketEscrow: ticketEscrow,
//     //                 prizeEscrow: prizeEscrow,
//     //                 creatorPrizeAta: creatorPrizeAta,
//     //                 ticketTokenProgram: TOKEN_PROGRAM_ID,
//     //                 prizeTokenProgram: TOKEN_PROGRAM_ID,
//     //                 systemProgram: SystemProgram.programId,
//     //             })
//     //             .signers([values.raffle_1_creator, values.raffle_admin])    // admin signer is missing
//     //             .rpc()
//     //     );
//     // });

//     // it("Fails when win shares not equal to 100", async () => {
//     //     await assert.rejects(
//     //         values.program.methods
//     //             .createRaffle(
//     //                 new anchor.BN(now),    // start time
//     //                 new anchor.BN(end),      // end time
//     //                 100,                // no.of tickets
//     //                 new anchor.BN(200_000_000),  // ticket amount to pay
//     //                 true,                 // is ticket mint sol
//     //                 20,                      // max per wallet PCT
//     //                 { sol: {} },                   // PrizeType enum
//     //                 new anchor.BN(1_000_000_000),  // prize amount
//     //                 5,                  // total winners
//     //                 Buffer.from([30, 20, 20, 10, 10]),  // winners shares != 100
//     //                 true,                      // is unique winners
//     //                 true                    // start raffle now
//     //             )
//     //             .accounts({
//     //                 raffleConfig: values.raffleConfigPda(),
//     //                 raffle: rafflePda,
//     //                 creator: values.raffle_1_creator.publicKey,
//     //                 raffleAdmin: values.raffle_admin.publicKey,   
//     //                 ticketMint: ticketMint,
//     //                 prizeMint: prizeMint,
//     //                 ticketEscrow: ticketEscrow,
//     //                 prizeEscrow: prizeEscrow,
//     //                 creatorPrizeAta: creatorPrizeAta,
//     //                 ticketTokenProgram: TOKEN_PROGRAM_ID,
//     //                 prizeTokenProgram: TOKEN_PROGRAM_ID,
//     //                 systemProgram: SystemProgram.programId,
//     //             })
//     //             .signers([values.raffle_1_creator, values.raffle_admin])    // admin signer is missing
//     //             .rpc()
//     //     );
//     // });

//     // it("Fails when start time is greater than current time", async () => {
//     //     await assert.rejects(
//     //         values.program.methods
//     //             .createRaffle(
//     //                 new anchor.BN(now - 100),    // start time is not valid
//     //                 new anchor.BN(end),      // end time
//     //                 100,                // no.of tickets
//     //                 new anchor.BN(200_000_000),  // ticket amount to pay
//     //                 true,                 // is ticket mint sol
//     //                 20,                      // max per wallet PCT
//     //                 { sol: {} },                   // PrizeType enum
//     //                 new anchor.BN(1_000_000_000),  // prize amount
//     //                 5,                  // total winners
//     //                 Buffer.from([30, 20, 20, 20, 10]),  // winners shares != 100
//     //                 true,                      // is unique winners
//     //                 false                    // start raffle now
//     //             )
//     //             .accounts({
//     //                 raffleConfig: values.raffleConfigPda(),
//     //                 raffle: rafflePda,
//     //                 creator: values.raffle_1_creator.publicKey,
//     //                 raffleAdmin: values.raffle_admin.publicKey,   
//     //                 ticketMint: ticketMint,
//     //                 prizeMint: prizeMint,
//     //                 ticketEscrow: ticketEscrow,
//     //                 prizeEscrow: prizeEscrow,
//     //                 creatorPrizeAta: creatorPrizeAta,
//     //                 ticketTokenProgram: TOKEN_PROGRAM_ID,
//     //                 prizeTokenProgram: TOKEN_PROGRAM_ID,
//     //                 systemProgram: SystemProgram.programId,
//     //             })
//     //             .signers([values.raffle_1_creator, values.raffle_admin])    // admin signer is missing
//     //             .rpc()
//     //     );
//     // });

//     // it("Fails when the raffle duration is not between the min and max raffle period", async () => {
//     //     await assert.rejects(
//     //         values.program.methods
//     //             .createRaffle(
//     //                 new anchor.BN(now),    // start time
//     //                 new anchor.BN(now + 10000000),      // b/w 1-24 hours
//     //                 100,                // no.of tickets
//     //                 new anchor.BN(200_000_000),  // ticket amount to pay
//     //                 true,                 // is ticket mint sol
//     //                 20,                      // max per wallet PCT
//     //                 { sol: {} },                   // PrizeType enum
//     //                 new anchor.BN(1_000_000_000),  // prize amount
//     //                 5,                  // total winners
//     //                 Buffer.from([30, 20, 20, 20, 10]),  // winners shares != 100
//     //                 true,                      // is unique winners
//     //                 false                    // start raffle now
//     //             )
//     //             .accounts({
//     //                 raffleConfig: values.raffleConfigPda(),
//     //                 raffle: rafflePda,
//     //                 creator: values.raffle_1_creator.publicKey,
//     //                 raffleAdmin: values.raffle_admin.publicKey,   
//     //                 ticketMint: ticketMint,
//     //                 prizeMint: prizeMint,
//     //                 ticketEscrow: ticketEscrow,
//     //                 prizeEscrow: prizeEscrow,
//     //                 creatorPrizeAta: creatorPrizeAta,
//     //                 ticketTokenProgram: TOKEN_PROGRAM_ID,
//     //                 prizeTokenProgram: TOKEN_PROGRAM_ID,
//     //                 systemProgram: SystemProgram.programId,
//     //             })
//     //             .signers([values.raffle_1_creator, values.raffle_admin])    // admin signer is missing
//     //             .rpc()
//     //     );
//     // });

//     // it("Fails for invalid wallet per PCT value", async () => {
//     //     // when tickets are 25 then min pct should be 4% , thne only any buyer can buy atleast 1 ticket
//     //     await assert.rejects(
//     //         values.program.methods
//     //             .createRaffle(
//     //                 new anchor.BN(now),    // start time
//     //                 new anchor.BN(end),      // end time
//     //                 25,                // no.of tickets
//     //                 new anchor.BN(200_000_000),  // ticket amount to pay
//     //                 true,                 // is ticket mint sol
//     //                 3,                      // max per wallet PCT
//     //                 { sol: {} },                   // PrizeType enum
//     //                 new anchor.BN(1_000_000_000),  // prize amount
//     //                 5,                  // total winners
//     //                 Buffer.from([30, 20, 20, 20, 10]),  // winners shares == 100
//     //                 true,                      // is unique winners
//     //                 false                    // start raffle now
//     //             )
//     //             .accounts({
//     //                 raffleConfig: values.raffleConfigPda(),
//     //                 raffle: rafflePda,
//     //                 creator: values.raffle_1_creator.publicKey,
//     //                 raffleAdmin: values.raffle_admin.publicKey,
//     //                 ticketMint: ticketMint,
//     //                 prizeMint: prizeMint,
//     //                 ticketEscrow: ticketEscrow,
//     //                 prizeEscrow: prizeEscrow,
//     //                 creatorPrizeAta: creatorPrizeAta,
//     //                 ticketTokenProgram: TOKEN_PROGRAM_ID,
//     //                 prizeTokenProgram: TOKEN_PROGRAM_ID,
//     //                 systemProgram: SystemProgram.programId,
//     //             })
//     //             .signers([values.raffle_1_creator, values.raffle_admin])    // admin signer is missing
//     //             .rpc()
//     //     );
//     // });

//     // it("Fails when creator gives wrong information about NFT prize mint", async () => {
//     //     // here we pass the mint as NFT, but the actual prize is SPL, there is not supply == 1 & decimlas == 0
//     //     await assert.rejects(
//     //         values.program.methods
//     //             .createRaffle(
//     //                 new anchor.BN(now),    // start time
//     //                 new anchor.BN(end),      // end time
//     //                 100,                // no.of tickets
//     //                 new anchor.BN(200_000_000),  // ticket amount to pay
//     //                 true,                 // is ticket mint sol
//     //                 20,                      // max per wallet PCT
//     //                 { nft: {} },                   // PrizeType enum
//     //                 new anchor.BN(1_000_000_000),  // prize amount(1 sol)
//     //                 1,                  // total winners
//     //                 Buffer.from([100]),  // winners shares == 100
//     //                 true,                      // is unique winners
//     //                 true                    // start raffle now
//     //             )
//     //             .accounts({
//     //                 raffleConfig: values.raffleConfigPda(),
//     //                 raffle: rafflePda,
//     //                 creator: values.raffle_1_creator.publicKey,
//     //                 raffleAdmin: values.raffle_admin.publicKey,
//     //                 ticketMint: ticketMint,
//     //                 prizeMint: prizeMint,
//     //                 ticketEscrow: ticketEscrow,
//     //                 prizeEscrow: prizeEscrow,
//     //                 creatorPrizeAta: creatorPrizeAta,
//     //                 ticketTokenProgram: TOKEN_PROGRAM_ID,
//     //                 prizeTokenProgram: TOKEN_PROGRAM_ID,
//     //                 systemProgram: SystemProgram.programId,
//     //             })
//     //             .signers([values.raffle_1_creator, values.raffle_admin])    // admin signer is missing
//     //             .rpc()
//     //     );
//     // });

//     // it("Fails when creator gives wrong creator ATA", async () => {
//     //     // create the NFT mint for prize and say that as SPL token
//     //     const NFT_prize_mint = await createNftMint(values.provider);
//     //     const prize_escrow = await createAta(values.provider, NFT_prize_mint, rafflePda);

//     //     // here we create the ATA or creator-2, but we call from cretor-1 , where the NFT is owned by creator-2 here no rigghts to transfer the NFT by creator-1
//     //     const creator_prize_ata = await createAta(values.provider, NFT_prize_mint, values.raffle_2_creator.publicKey);
//     //     await mintTokensToAta(
//     //         values.provider,
//     //         NFT_prize_mint,
//     //         creator_prize_ata,
//     //         1
//     //     );

//     //     await assert.rejects(
//     //         values.program.methods
//     //         .createRaffle(
//     //             new anchor.BN(now),    // start time
//     //             new anchor.BN(end),      // end time
//     //             100,                // no.of tickets
//     //             new anchor.BN(200_000_000),  // ticket amount to pay
//     //             true,                 // is ticket mint sol
//     //             20,                      // max per wallet PCT
//     //             { nft: {} },                   // PrizeType enum
//     //             new anchor.BN(1_000_000_000),  // prize amount(1 sol)
//     //             1,                  // total winners
//     //             Buffer.from([100]),  // winners shares == 100
//     //             true,                      // is unique winners
//     //             true                    // start raffle now
//     //         )
//     //         .accounts({
//     //             raffleConfig: values.raffleConfigPda(),
//     //             raffle: rafflePda,
//     //             creator: values.raffle_1_creator.publicKey,
//     //             raffleAdmin: values.raffle_admin.publicKey,
//     //             ticketMint: ticketMint,
//     //             prizeMint: NFT_prize_mint,
//     //             ticketEscrow: ticketEscrow,
//     //             prizeEscrow: prize_escrow,
//     //             creatorPrizeAta: creator_prize_ata,
//     //             ticketTokenProgram: TOKEN_PROGRAM_ID,
//     //             prizeTokenProgram: TOKEN_PROGRAM_ID,
//     //             systemProgram: SystemProgram.programId,
//     //         })
//     //         .signers([values.raffle_1_creator, values.raffle_admin])    // admin signer is missing
//     //         .rpc()
//     //     );
//     // });

//     // it("Fails when prize escrow is a wrong owner", async () => {
//     //     // create the NFT mint for prize and say that as SPL token
//     //     const NFT_prize_mint = await createNftMint(values.provider);
//     //     const creator_prize_ata = await createAta(values.provider, NFT_prize_mint, values.raffle_1_creator.publicKey);

//     //     // here the prize escrow owner should be Raffle, but we set to creator-2
//     //     const prize_escrow = await createAta(values.provider, NFT_prize_mint, values.raffle_2_creator.publicKey);
//     //     await mintTokensToAta(
//     //         values.provider,
//     //         NFT_prize_mint,
//     //         creator_prize_ata,
//     //         1
//     //     );

//     //     await assert.rejects(
//     //         values.program.methods
//     //             .createRaffle(
//     //                 new anchor.BN(now),    // start time
//     //                 new anchor.BN(end),      // end time
//     //                 100,                // no.of tickets
//     //                 new anchor.BN(200_000_000),  // ticket amount to pay
//     //                 true,                 // is ticket mint sol
//     //                 20,                      // max per wallet PCT
//     //                 { nft: {} },                   // PrizeType enum
//     //                 new anchor.BN(1_000_000_000),  // prize amount(1 sol)
//     //                 1,                  // total winners
//     //                 Buffer.from([100]),  // winners shares == 100
//     //                 true,                      // is unique winners
//     //                 true                    // start raffle now
//     //             )
//     //             .accounts({
//     //                 raffleConfig: values.raffleConfigPda(),
//     //                 raffle: rafflePda,
//     //                 creator: values.raffle_1_creator.publicKey,
//     //                 raffleAdmin: values.raffle_admin.publicKey,
//     //                 ticketMint: ticketMint,
//     //                 prizeMint: NFT_prize_mint,
//     //                 ticketEscrow: ticketEscrow,
//     //                 prizeEscrow: prize_escrow,
//     //                 creatorPrizeAta: creator_prize_ata,
//     //                 ticketTokenProgram: TOKEN_PROGRAM_ID,
//     //                 prizeTokenProgram: TOKEN_PROGRAM_ID,
//     //                 systemProgram: SystemProgram.programId,
//     //             })
//     //             .signers([values.raffle_1_creator, values.raffle_admin])    // admin signer is missing
//     //             .rpc()
//     //     );
//     // });

//     // it("Fails when prize escrow owner is correct, but given wrong mint address", async () => {
//     //     // create the NFT mint for prize and say that as SPL token
//     //     const NFT_prize_mint = await createNftMint(values.provider);
//     //     const creator_prize_ata = await createAta(values.provider, NFT_prize_mint, values.raffle_1_creator.publicKey);

//     //     // here we creator ATA for rafflw with other Mint
//     //     const prize_escrow = await createAta(values.provider, prizeMint, rafflePda);
//     //     await mintTokensToAta(
//     //         values.provider,
//     //         NFT_prize_mint,
//     //         creator_prize_ata,
//     //         1
//     //     );

//     //     await assert.rejects(
//     //         values.program.methods
//     //         .createRaffle(
//     //             new anchor.BN(now),    // start time
//     //             new anchor.BN(end),      // end time
//     //             100,                // no.of tickets
//     //             new anchor.BN(200_000_000),  // ticket amount to pay
//     //             true,                 // is ticket mint sol
//     //             20,                      // max per wallet PCT
//     //             { nft: {} },                   // PrizeType enum
//     //             new anchor.BN(1_000_000_000),  // prize amount(1 sol)
//     //             1,                  // total winners
//     //             Buffer.from([100]),  // winners shares == 100
//     //             true,                      // is unique winners
//     //             true                    // start raffle now
//     //         )
//     //         .accounts({
//     //             raffleConfig: values.raffleConfigPda(),
//     //             raffle: rafflePda,
//     //             creator: values.raffle_1_creator.publicKey,
//     //             raffleAdmin: values.raffle_admin.publicKey,
//     //             ticketMint: ticketMint,
//     //             prizeMint: NFT_prize_mint,
//     //             ticketEscrow: ticketEscrow,
//     //             prizeEscrow: prize_escrow,
//     //             creatorPrizeAta: creator_prize_ata,
//     //             ticketTokenProgram: TOKEN_PROGRAM_ID,
//     //             prizeTokenProgram: TOKEN_PROGRAM_ID,
//     //             systemProgram: SystemProgram.programId,
//     //         })
//     //         .signers([values.raffle_1_creator, values.raffle_admin])    // admin signer is missing
//     //         .rpc()
//     //     );
//     // });

//     // it("Fails when ticket mint is SPL and ticket ecrow owner is not rafFle PDA", async () => {
//     //     const ticket_escrow = await createAta(values.provider, ticketMint, values.raffle_1_creator.publicKey);

//     //     await assert.rejects(
//     //         values.program.methods
//     //         .createRaffle(
//     //             new anchor.BN(now),    // start time
//     //             new anchor.BN(end),      // end time
//     //             100,                // no.of tickets
//     //             new anchor.BN(200_000_000),  // ticket amount to pay
//     //             false,                 // is ticket mint sol
//     //             20,                      // max per wallet PCT
//     //             { sol: {} },                   // PrizeType enum
//     //             new anchor.BN(1_000_000_000),  // prize amount(1 sol)
//     //             1,                  // total winners
//     //             Buffer.from([100]),  // winners shares == 100
//     //             true,                      // is unique winners
//     //             true                    // start raffle now
//     //         )
//     //         .accounts({
//     //             raffleConfig: values.raffleConfigPda(),
//     //             raffle: rafflePda,
//     //             creator: values.raffle_1_creator.publicKey,
//     //             raffleAdmin: values.raffle_admin.publicKey,
//     //             ticketMint: ticketMint,
//     //             prizeMint: prizeMint,
//     //             ticketEscrow: ticket_escrow,
//     //             prizeEscrow: prizeEscrow,
//     //             creatorPrizeAta: creatorPrizeAta,
//     //             ticketTokenProgram: TOKEN_PROGRAM_ID,
//     //             prizeTokenProgram: TOKEN_PROGRAM_ID,
//     //             systemProgram: SystemProgram.programId,
//     //         })
//     //         .signers([values.raffle_1_creator, values.raffle_admin])    // admin signer is missing
//     //         .rpc()
//     //     );
//     // });

//     // it("Fails when ticket mint is SPL and given ticket escrow mint is not matched with passed ticket mint", async () => {
//     //     // here the ticker escrow owner is correct but the mint address is wrong
//     //     const second_ticket_mint = await createSplMint(values.provider);
//     //     const ticket_escrow = await createAta(values.provider, second_ticket_mint, rafflePda);

//     //     await assert.rejects(
//     //         values.program.methods
//     //             .createRaffle(
//     //                 new anchor.BN(now),    // start time
//     //                 new anchor.BN(end),      // end time
//     //                 100,                // no.of tickets
//     //                 new anchor.BN(200_000_000),  // ticket amount to pay
//     //                 false,                 // is ticket mint sol
//     //                 20,                      // max per wallet PCT
//     //                 { sol: {} },                   // PrizeType enum
//     //                 new anchor.BN(1_000_000_000),  // prize amount(1 sol)
//     //                 1,                  // total winners
//     //                 Buffer.from([100]),  // winners shares == 100
//     //                 true,                      // is unique winners
//     //                 true                    // start raffle now
//     //             )
//     //             .accounts({
//     //                 raffleConfig: values.raffleConfigPda(),
//     //                 raffle: rafflePda,
//     //                 creator: values.raffle_1_creator.publicKey,
//     //                 raffleAdmin: values.raffle_admin.publicKey,
//     //                 ticketMint: ticketMint,
//     //                 prizeMint: prizeMint,
//     //                 ticketEscrow: ticket_escrow,
//     //                 prizeEscrow: prizeEscrow,
//     //                 creatorPrizeAta: creatorPrizeAta,
//     //                 ticketTokenProgram: TOKEN_PROGRAM_ID,
//     //                 prizeTokenProgram: TOKEN_PROGRAM_ID,
//     //                 systemProgram: SystemProgram.programId,
//     //             })
//     //             .signers([values.raffle_1_creator, values.raffle_admin])    // admin signer is missing
//     //             .rpc()
//     //     );
//     // });
// });

describe("Create raffle with valid data", () => {
    let cfg, raffleId, rafflePda;
    let ticketMint, prizeMint;
    let ticketEscrow, prizeEscrow, creatorPrizeAta;
    let slot, now, end;

    before(async () => {
        await transferSol(values.provider.wallet.payer, values.raffle_owner.publicKey, 1_000_000_000);
        await transferSol(values.provider.wallet.payer, values.raffle_1_creator.publicKey, 10_000_000_000);

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

        slot = await values.program.provider.connection.getSlot();
        now = await values.program.provider.connection.getBlockTime(slot);
        end = now + 3700;
    });

    it("creates a raffle successfully", async () => {
        await createRaffle(
            values.program,
            {
                startTime: now,
                endTime: end,
                totalTickets: 100,
                ticketPrice: 200_000_000, // 0.2 SOL
                isTicketSol: true,
                maxPct: 20,
                prizeType: { sol: {} },
                prizeAmount: 1_000_000_000, // 1 SOL
                numWinners: 1,
                winShares: [100], // converted to Uint8Array in helper
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

        console.log("Raffle created successfully!");

        const raffle = await values.program.account.raffle.fetch(rafflePda);

        assert.equal(raffle.raffleId, raffleId);
        assert.equal(raffle.totalTickets, 100);
        assert.equal(raffle.ticketPrice.toNumber(), 200_000_000);
        assert.equal(raffle.numWinners, 1);
        assert.equal(raffle.winShares.length, 1);
        assert.equal(raffle.winShares[0], 100);
        assert.deepEqual(raffle.prizeType, { sol: {} });
        assert.deepEqual(raffle.status, { active: {} });
    });
});