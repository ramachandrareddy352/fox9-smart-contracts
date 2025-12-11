import * as anchor from "@coral-xyz/anchor";
import { startAnchor } from "solana-bankrun";
import { BankrunProvider } from "anchor-bankrun";
import { Keypair, SystemProgram, PublicKey } from "@solana/web3.js";

import {
    setProgram,
    setProvider,
    auction_owner,
    auction_admin,
    auctionConfigPda,
    creation_fee_lamports,
    commission_bps,
    minimum_auction_period,
    maximum_auction_period,
    minimum_time_extension,
    maximum_time_extension,
    auction_1_creator,
    auction_2_creator,
} from "./values";

import {
    createAuctionConfig,
    createSplMint,
    createNftMint,
    createAta,
    mintTokens,
    getCurrentTimestamp,
    deriveAuctionPda,
} from "./helpers";

import { Auction } from "../target/types/auction";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";

describe("Create Auction Tests", () => {
    let context: any;
    let provider: BankrunProvider;
    let program: anchor.Program<Auction>;

    before(async () => {
        context = await startAnchor("", [], []);
        provider = new BankrunProvider(context);
        anchor.setProvider(provider);
        setProvider(provider);

        program = anchor.workspace.Auction as anchor.Program<Auction>;
        setProgram(program);

        // Fund all accounts
        for (const kp of [auction_owner, auction_admin, auction_1_creator, auction_2_creator]) {
            await context.setAccount(kp.publicKey, {
                lamports: 50_000_000_000,
                owner: SystemProgram.programId,
                executable: false,
                data: Buffer.alloc(0),
            });
        }

        // Create config once
        await createAuctionConfig(program, auction_owner, auction_admin.publicKey, {
            creationFeeLamports: creation_fee_lamports,
            commision_bps: commission_bps,
            minPeriod: minimum_auction_period,
            maxPeriod: maximum_auction_period,
            minTimeExtension: minimum_time_extension,
            maxTimeExtension: maximum_time_extension,
        });
    });

    // Helper to auto-build accounts for create_auction tests
    async function setupPrizeNFT(creator: Keypair, auctionPda: PublicKey) {
        const nftMint = await createNftMint();
        const creatorAta = await createAta(nftMint, creator.publicKey);
        const prizeEscrow = await createAta(nftMint, auctionPda);
        await mintTokens(nftMint, creatorAta, 1);

        return { nftMint, creatorAta, prizeEscrow };
    }

    it("Create Auction Successfully (NFT Prize)", async () => {

        const now = await getCurrentTimestamp();
        const startTime = now + 20;
        const endTime = startTime + minimum_auction_period + 100;

        const cfg = await program.account.auctionConfig.fetch(auctionConfigPda());
        const auctionId = cfg.auctionCount;

        const auctionPda = await deriveAuctionPda(program, auctionId)

        const { nftMint, creatorAta, prizeEscrow } = await setupPrizeNFT(auction_1_creator, auctionPda);

        // Run create_auction
        await program.methods
            .createAuction(
                new anchor.BN(startTime),
                new anchor.BN(endTime),
                false,             // startImmediately
                true,              // bid mint = SOL
                new anchor.BN(0),  // base bid
                new anchor.BN(10_000_000), // min increment, 0.01 sol
                minimum_time_extension
            )
            .accounts({
                auctionConfig: auctionConfigPda(),
                auction: auctionPda, // PDA
                creator: auction_1_creator.publicKey,
                auctionAdmin: auction_admin.publicKey,
                prizeMint: nftMint,
                bidMint: nftMint,  // ignored because is_bid_mint_sol = true
                creatorPrizeAta: creatorAta,
                prizeEscrow,
                prizeTokenProgram: TOKEN_PROGRAM_ID,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
            })
            .signers([auction_1_creator, auction_admin])
            .rpc();

        const auction = await program.account.auction.fetch(auctionPda);
        console.log("\n=== Auction Created ===");
        console.log(auction)

        if (auction.prizeMint.toBase58() !== nftMint.toBase58())
            throw new Error("NFT mint mismatch");
    });

    // it("Reject: prize mint is SPL (not NFT)", async () => {
    //     const creator = Keypair.generate();
    //     await context.setAccount(creator.publicKey, {
    //         lamports: 20_000_000_000,
    //         owner: SystemProgram.programId,
    //         executable: false,
    //         data: Buffer.alloc(0),
    //     });

    //     // Create SPL mint (decimals 9, supply > 1)
    //     const splMint = await createSplMint(9);
    //     const creatorAta = await createAta(splMint, creator.publicKey);
    //     await mintTokens(splMint, creatorAta, 1_000_000_000);

    //     const now = await getCurrentTimestamp();
    //     const startTime = now + 10;
    //     const endTime = startTime + minimum_auction_period + 100;

    //     const cfg = await program.account.auctionConfig.fetch(auctionConfigPda());
    //     const auctionId = cfg.auctionCount;

    //     const auctionPda = await buildAuctionPDAs(auctionId);

    //     try {
    //         await program.methods
    //             .createAuction(
    //                 new anchor.BN(startTime),
    //                 new anchor.BN(endTime),
    //                 false,
    //                 true,
    //                 new anchor.BN(1),
    //                 new anchor.BN(10),
    //                 minimum_time_extension
    //             )
    //             .accounts({
    //                 auctionConfig: auctionConfigPda(),
    //                 auction: auctionPda,
    //                 creator: creator.publicKey,
    //                 auctionAdmin: auction_admin.publicKey,
    //                 prizeMint: splMint, // WRONG: not NFT
    //                 bidMint: splMint,

    //                 creatorPrizeAta: creatorAta,
    //                 prizeEscrow: await createAta(splMint, auctionPda),
    //                 prizeTokenProgram: TOKEN_PROGRAM_ID,
    //                 associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    //                 systemProgram: SystemProgram.programId,
    //             })
    //             .signers([creator, auction_admin])
    //             .rpc();

    //         throw new Error("Should have failed but succeeded!");
    //     } catch (err) {
    //         console.log("Expected NFT validation rejection:", err.error?.errorMessage);
    //     }
    // });

    // it("Reject: startImmediately = false but start_time < now", async () => {
    //     const creator = Keypair.generate();
    //     await context.setAccount(creator.publicKey, {
    //         lamports: 20_000_000_000,
    //         owner: SystemProgram.programId,
    //         executable: false,
    //         data: Buffer.alloc(0),
    //     });

    //     const { nftMint, creatorAta } = await setupPrizeNFT(creator);

    //     const now = await getCurrentTimestamp();
    //     const startTime = now - 50;  // INVALID
    //     const endTime = startTime + minimum_auction_period + 100;

    //     const cfg = await program.account.auctionConfig.fetch(auctionConfigPda());
    //     const auctionId = cfg.auctionCount;
    //     const auctionPda = await buildAuctionPDAs(auctionId);

    //     try {
    //         await program.methods
    //             .createAuction(
    //                 new anchor.BN(startTime),
    //                 new anchor.BN(endTime),
    //                 false,            // do not force now
    //                 true,
    //                 new anchor.BN(1),
    //                 new anchor.BN(10),
    //                 minimum_time_extension
    //             )
    //             .accounts({
    //                 auctionConfig: auctionConfigPda(),
    //                 auction: auctionPda,
    //                 creator: creator.publicKey,
    //                 auctionAdmin: auction_admin.publicKey,
    //                 prizeMint: nftMint,
    //                 bidMint: nftMint,
    //                 creatorPrizeAta: creatorAta,
    //                 prizeEscrow: await createAta(nftMint, auctionPda),
    //                 prizeTokenProgram: TOKEN_PROGRAM_ID,
    //                 associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    //                 systemProgram: SystemProgram.programId,
    //             })
    //             .signers([creator, auction_admin])
    //             .rpc();

    //         throw new Error("Should have failed due to past start_time");
    //     } catch (err) {
    //         console.log("Expected past-start rejection:", err.error?.errorMessage);
    //     }
    // });

    // it("Reject: min_increment = 0", async () => {
    //     const creator = Keypair.generate();
    //     const { nftMint, creatorAta } = await setupPrizeNFT(creator);

    //     await context.setAccount(creator.publicKey, {
    //         lamports: 20_000_000_000,
    //         owner: SystemProgram.programId,
    //         executable: false,
    //         data: Buffer.alloc(0),
    //     });

    //     const now = await getCurrentTimestamp();
    //     const startTime = now + 50;
    //     const endTime = startTime + minimum_auction_period + 100;

    //     const cfg = await program.account.auctionConfig.fetch(auctionConfigPda());
    //     const auctionId = cfg.auctionCount;
    //     const auctionPda = await buildAuctionPDAs(auctionId);

    //     try {
    //         await program.methods
    //             .createAuction(
    //                 new anchor.BN(startTime),
    //                 new anchor.BN(endTime),
    //                 false,
    //                 true,
    //                 new anchor.BN(1),
    //                 new anchor.BN(0),   // INVALID
    //                 minimum_time_extension
    //             )
    //             .accounts({
    //                 auctionConfig: auctionConfigPda(),
    //                 auction: auctionPda,
    //                 creator: creator.publicKey,
    //                 auctionAdmin: auction_admin.publicKey,
    //                 prizeMint: nftMint,
    //                 bidMint: nftMint,
    //                 creatorPrizeAta: creatorAta,
    //                 prizeEscrow: await createAta(nftMint, auctionPda),
    //                 prizeTokenProgram: TOKEN_PROGRAM_ID,
    //                 associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    //                 systemProgram: SystemProgram.programId,
    //             })
    //             .signers([creator, auction_admin])
    //             .rpc();

    //         throw new Error("min_increment=0 should fail");
    //     } catch (err) {
    //         console.log("Expected min_increment=0 rejection:", err.error?.errorMessage);
    //     }
    // });

    // it("Reject: time_extension less than minimum", async () => {
    //     const creator = Keypair.generate();
    //     const { nftMint, creatorAta } = await setupPrizeNFT(creator);

    //     await context.setAccount(creator.publicKey, {
    //         lamports: 20_000_000_000,
    //         owner: SystemProgram.programId,
    //         executable: false,
    //         data: Buffer.alloc(0),
    //     });

    //     const now = await getCurrentTimestamp();
    //     const startTime = now + 100;
    //     const endTime = startTime + minimum_auction_period + 150;

    //     const cfg = await program.account.auctionConfig.fetch(auctionConfigPda());
    //     const auctionId = cfg.auctionCount;
    //     const auctionPda = await buildAuctionPDAs(auctionId);

    //     try {
    //         await program.methods
    //             .createAuction(
    //                 new anchor.BN(startTime),
    //                 new anchor.BN(endTime),
    //                 false,
    //                 true,
    //                 new anchor.BN(10),
    //                 new anchor.BN(1),
    //                 minimum_time_extension - 5  // INVALID
    //             )
    //             .accounts({
    //                 auctionConfig: auctionConfigPda(),
    //                 auction: auctionPda,
    //                 creator: creator.publicKey,
    //                 auctionAdmin: auction_admin.publicKey,
    //                 prizeMint: nftMint,
    //                 bidMint: nftMint,
    //                 creatorPrizeAta: creatorAta,
    //                 prizeEscrow: await createAta(nftMint, auctionPda),
    //                 prizeTokenProgram: TOKEN_PROGRAM_ID,
    //                 associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    //                 systemProgram: SystemProgram.programId,
    //             })
    //             .signers([creator, auction_admin])
    //             .rpc();

    //         throw new Error("time_extension invalid range should fail");
    //     } catch (err) {
    //         console.log("Expected time extension rejection:", err.error?.errorMessage);
    //     }
    // });

    // it("Reject: wrong admin tries to create auction", async () => {
    //     const creator = Keypair.generate();
    //     const fakeAdmin = Keypair.generate();

    //     await context.setAccount(creator.publicKey, {
    //         lamports: 20_000_000_000,
    //         owner: SystemProgram.programId,
    //         executable: false,
    //         data: Buffer.alloc(0),
    //     });
    //     await context.setAccount(fakeAdmin.publicKey, {
    //         lamports: 10_000_000_000,
    //         owner: SystemProgram.programId,
    //         executable: false,
    //         data: Buffer.alloc(0),
    //     });

    //     const { nftMint, creatorAta } = await setupPrizeNFT(creator);

    //     const now = await getCurrentTimestamp();
    //     const startTime = now + 20;
    //     const endTime = startTime + minimum_auction_period + 100;

    //     const cfg = await program.account.auctionConfig.fetch(auctionConfigPda());
    //     const auctionId = cfg.auctionCount;
    //     const auctionPda = await buildAuctionPDAs(auctionId);

    //     try {
    //         await program.methods
    //             .createAuction(
    //                 new anchor.BN(startTime),
    //                 new anchor.BN(endTime),
    //                 false,
    //                 true,
    //                 new anchor.BN(10),
    //                 new anchor.BN(20),
    //                 minimum_time_extension
    //             )
    //             .accounts({
    //                 auctionConfig: auctionConfigPda(),
    //                 auction: auctionPda,
    //                 creator: creator.publicKey,
    //                 auctionAdmin: fakeAdmin.publicKey, // WRONG admin
    //                 prizeMint: nftMint,
    //                 bidMint: nftMint,
    //                 creatorPrizeAta: creatorAta,
    //                 prizeEscrow: await createAta(nftMint, auctionPda),
    //                 prizeTokenProgram: TOKEN_PROGRAM_ID,
    //                 associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    //                 systemProgram: SystemProgram.programId,
    //             })
    //             .signers([creator, fakeAdmin])
    //             .rpc();

    //         throw new Error("Wrong admin should fail");
    //     } catch (err) {
    //         console.log("Expected wrong-admin rejection:", err.error?.errorMessage);
    //     }
    // });

    // it("Create Auction With startImmediately=true", async () => {
    //     const creator = Keypair.generate();
    //     const { nftMint, creatorAta } = await setupPrizeNFT(creator);

    //     await context.setAccount(creator.publicKey, {
    //         lamports: 20_000_000_000,
    //         owner: SystemProgram.programId,
    //         executable: false,
    //         data: Buffer.alloc(0),
    //     });

    //     const now = await getCurrentTimestamp();
    //     const startTime = now + 999999; // ignored
    //     const endTime = now + minimum_auction_period + 200;

    //     const cfg = await program.account.auctionConfig.fetch(auctionConfigPda());
    //     const auctionId = cfg.auctionCount;
    //     const auctionPda = await buildAuctionPDAs(auctionId);

    //     await program.methods
    //         .createAuction(
    //             new anchor.BN(startTime),
    //             new anchor.BN(endTime),
    //             true,  // start immediately
    //             true,
    //             new anchor.BN(1),
    //             new anchor.BN(10),
    //             minimum_time_extension
    //         )
    //         .accounts({
    //             auctionConfig: auctionConfigPda(),
    //             auction: auctionPda,
    //             creator: creator.publicKey,
    //             auctionAdmin: auction_admin.publicKey,
    //             prizeMint: nftMint,
    //             bidMint: nftMint,
    //             creatorPrizeAta: creatorAta,
    //             prizeEscrow: await createAta(nftMint, auctionPda),
    //             prizeTokenProgram: TOKEN_PROGRAM_ID,
    //             associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    //             systemProgram: SystemProgram.programId,
    //         })
    //         .signers([creator, auction_admin])
    //         .rpc();

    //     const auction = await program.account.auction.fetch(auctionPda);

    //     console.log("Auction After startImmediately:", {
    //         status: auction.status,
    //         start_time: auction.startTime,
    //     });
    // });
});
