import * as anchor from "@coral-xyz/anchor";
import { startAnchor } from "solana-bankrun";
import { BankrunProvider } from "anchor-bankrun";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

import {
    createAuctionConfig,
    createAuction,
    startAuction,
    placeBid,
    createSplMint,
    createAta,
    mintTokens,
    getSolBalance,
    getTokenBalance,
    warpForward,
    getCurrentTimestamp,
    deriveAuctionPda,
    cancelAuction,
    completeAuction,
} from "./helpers";

import {
    auction_owner,
    auction_admin,
    auction_1_creator,
    auction_2_creator,
    creation_fee_lamports,
    commission_bps,
    minimum_auction_period,
    maximum_auction_period,
    minimum_time_extension,
    maximum_time_extension,
    setProgram,
    setProvider,
    auctionConfigPda,
    auctionPda,
} from "./values";

import type { Auction } from "../target/types/auction";
import assert from "assert";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

describe("Auction Bidding – SOL & SPL", () => {
    let context: any;
    let provider: BankrunProvider;
    let program: anchor.Program<Auction>;

    // Auction A (SOL bids)
    let solAuctionId: number;
    let solAuctionPda: PublicKey;
    let solPrizeMint: PublicKey;
    let solCreatorPrizeAta: PublicKey;
    let solPrizeEscrow: PublicKey;

    // Auction B (SPL bids)
    let splAuctionId: number;
    let splAuctionPda: PublicKey;
    let splPrizeMint: PublicKey;
    let splCreatorPrizeAta: PublicKey;
    let splPrizeEscrow: PublicKey;
    let splBidMint: PublicKey;
    let splBidEscrow: PublicKey;

    before(async () => {
        context = await startAnchor("", [], []);
        provider = new BankrunProvider(context);
        anchor.setProvider(provider);
        setProvider(provider);

        program = anchor.workspace.Auction as anchor.Program<Auction>;
        setProgram(program);

        // FUND main keypairs
        for (const kp of [auction_owner, auction_admin, auction_1_creator, auction_2_creator]) {
            await context.setAccount(kp.publicKey, {
                lamports: 20_000_000_000,
                owner: SystemProgram.programId,
                executable: false,
                data: Buffer.alloc(0),
            });
        }

        // 1. INITIALIZE GLOBAL CONFIG
        await createAuctionConfig(program, auction_owner, auction_admin.publicKey, {
            creationFeeLamports: creation_fee_lamports,
            commision_bps: commission_bps,
            minPeriod: minimum_auction_period,
            maxPeriod: maximum_auction_period,
            minTimeExtension: minimum_time_extension,
            maxTimeExtension: maximum_time_extension,
        });


        // 2. SETUP AUCTION A (SOL BID AUCTION)
        solPrizeMint = await createSplMint(0); // NFT (decimals=0)
        solCreatorPrizeAta = await createAta(solPrizeMint, auction_1_creator.publicKey);
        solPrizeEscrow = await createAta(solPrizeMint, auctionPda(1)); // temporarily but replaced when auction created

        // Mint the NFT to the creator
        await mintTokens(solPrizeMint, solCreatorPrizeAta, 1);

        const solStart = await getCurrentTimestamp();
        const solEnd = solStart + minimum_auction_period + 100;

        const solAuctionResp = await createAuction(program, {
            creator: auction_1_creator,
            auctionAdmin: auction_admin,
            prizeMint: solPrizeMint,
            bidMint: null,                     // SOL auction, no need of check here
            creatorPrizeAta: solCreatorPrizeAta,
            prizeEscrow: solPrizeEscrow,
            startTime: Number(solStart),
            endTime: Number(solEnd),
            startImmediately: true,
            baseBid: 1_000_000_000,            // 1 SOL
            minIncrement: 500_000_000,         // +0.5 SOL
            timeExtension: minimum_time_extension,
        });

        solAuctionId = solAuctionResp.auctionId;
        solAuctionPda = await deriveAuctionPda(program, solAuctionId);

        // 3. SETUP AUCTION B (SPL BID AUCTION)
        splPrizeMint = await createSplMint(0); // NFT
        splCreatorPrizeAta = await createAta(splPrizeMint, auction_2_creator.publicKey);
        splPrizeEscrow = await createAta(splPrizeMint, auctionPda(2));
        await mintTokens(splPrizeMint, splCreatorPrizeAta, 1);

        // SPL mint used for bidding
        splBidMint = await createSplMint(9);

        // Create SPL bid escrow ATA owned by auction PDA (created AFTER auction init)
        splBidEscrow = await createAta(splBidMint, auctionPda(2));

        const splStart = await getCurrentTimestamp();
        const splEnd = splStart + minimum_auction_period + 100;

        const splAuctionResp = await createAuction(program, {
            creator: auction_2_creator,
            auctionAdmin: auction_admin,
            prizeMint: splPrizeMint,
            bidMint: splBidMint,               // SPL bid
            creatorPrizeAta: splCreatorPrizeAta,
            prizeEscrow: splPrizeEscrow,
            startTime: Number(splStart),
            endTime: Number(splEnd),
            startImmediately: true,
            baseBid: 1_000_000_000,           // 1 tokens
            minIncrement: 500_000_000,       // +0.5 tokens
            timeExtension: minimum_time_extension,
        });

        splAuctionId = splAuctionResp.auctionId;
        splAuctionPda = await deriveAuctionPda(program, splAuctionId);
    });

    // it("First SOL bid (no previous bidder)", async () => {
    //     console.log("\n================ FIRST SOL BID ================");

    //     const bidder = Keypair.generate();
    //     const bidder2 = Keypair.generate();

    //     await context.setAccount(bidder.publicKey, {
    //         lamports: 20_000_000_000, // 20 SOL
    //         owner: SystemProgram.programId,
    //         executable: false,
    //         data: Buffer.alloc(0),
    //     });

    //     await context.setAccount(bidder2.publicKey, {
    //         lamports: 20_000_000_000, // 20 SOL
    //         owner: SystemProgram.programId,
    //         executable: false,
    //         data: Buffer.alloc(0),
    //     });

    //     // INITIAL BALANCES
    //     const solBeforeBidder1 = await getSolBalance(bidder.publicKey);
    //     const solBeforeBidder2 = await getSolBalance(bidder2.publicKey);
    //     const solBeforeAuction = await getSolBalance(solAuctionPda);

    //     console.log("\n---- INITIAL BALANCES ----");
    //     console.log("Bidder1 SOL:", solBeforeBidder1);
    //     console.log("Bidder2 SOL:", solBeforeBidder2);
    //     console.log("Auction PDA SOL:", solBeforeAuction);

    //     // PLACE FIRST BID (Bidder1 → 2 SOL)
    //     await placeBid(program, {
    //         auctionId: solAuctionId,
    //         bidder,
    //         auctionAdmin: auction_admin,
    //         bidAmount: 2_000_000_000,
    //         bidMint: solPrizeMint,
    //         bidderAta: solPrizeEscrow,
    //         prevBidder: PublicKey.unique(),
    //         prevBidderAta: solPrizeEscrow,
    //         bidEscrow: solPrizeEscrow,
    //     });

    //     const solAfterFirstBidder1 = await getSolBalance(bidder.publicKey);
    //     const solAfterFirstAuction = await getSolBalance(solAuctionPda);

    //     console.log("\n---- AFTER FIRST BID ----");
    //     console.log("Bidder1 SOL:", solAfterFirstBidder1, " (paid:", solBeforeBidder1 - solAfterFirstBidder1, ")");
    //     console.log("Auction PDA SOL:", solAfterFirstAuction, " (received:", solAfterFirstAuction - solBeforeAuction, ")");


    //     // PLACE SECOND BID (Bidder2 → 3 SOL)
    //     await placeBid(program, {
    //         auctionId: solAuctionId,
    //         bidder: bidder2,
    //         auctionAdmin: auction_admin,
    //         bidAmount: 3_000_000_000,
    //         bidMint: solPrizeMint,
    //         bidderAta: solPrizeEscrow,
    //         prevBidder: bidder.publicKey,
    //         prevBidderAta: solPrizeEscrow,
    //         bidEscrow: solPrizeEscrow,
    //     });

    //     const solAfterSecondBidder1 = await getSolBalance(bidder.publicKey);
    //     const solAfterSecondBidder2 = await getSolBalance(bidder2.publicKey);
    //     const solAfterSecondAuction = await getSolBalance(solAuctionPda);

    //     console.log("\n---- AFTER SECOND BID ----");
    //     console.log("Bidder1 SOL (refunded):", solAfterSecondBidder1,
    //         " (refund:", solAfterSecondBidder1 - solAfterFirstBidder1, ")");
    //     console.log("Bidder2 SOL:", solAfterSecondBidder2,
    //         " (paid:", solBeforeBidder2 - solAfterSecondBidder2, ")");
    //     console.log("Auction PDA SOL:", solAfterSecondAuction,
    //         " (net received:", solAfterSecondAuction - solBeforeAuction, ")");


    //     // WARP & PRE-COMPLETE BALANCES
    //     console.log("\nWarping forward beyond auction end...");
    //     await warpForward(20000);

    //     const configPda = auctionConfigPda();
    //     const winner = bidder2;
    //     const winnerPrizeAta = await createAta(solPrizeMint, winner.publicKey);

    //     const beforeCompleteAuctionSol = await getSolBalance(solAuctionPda);
    //     const beforeCompleteConfigSol = await getSolBalance(configPda);
    //     const beforeCompleteCreatorSol = await getSolBalance(auction_1_creator.publicKey);
    //     const beforePrizeEscrowBal = await getTokenBalance(solPrizeEscrow);
    //     const beforeWinnerPrizeBal = await getTokenBalance(winnerPrizeAta);

    //     console.log("\n---- BEFORE COMPLETE ----");
    //     console.log("Auction PDA SOL:", beforeCompleteAuctionSol);
    //     console.log("Config PDA SOL:", beforeCompleteConfigSol);
    //     console.log("Creator SOL:", beforeCompleteCreatorSol);
    //     console.log("Prize Escrow NFT:", beforePrizeEscrowBal);
    //     console.log("Winner Prize ATA:", beforeWinnerPrizeBal);


    //     // COMPLETE AUCTION
    //     await completeAuction(program, {
    //         auctionId: solAuctionId,
    //         auctionAdmin: auction_admin,
    //         creator: auction_1_creator.publicKey,
    //         winner: winner.publicKey,
    //         prizeMint: solPrizeMint,
    //         bidMint: solPrizeMint,
    //         prizeEscrow: solPrizeEscrow,
    //         bidEscrow: solPrizeEscrow,
    //         creatorPrizeAta: solCreatorPrizeAta,
    //         winnerPrizeAta: winnerPrizeAta,
    //         bidFeeTreasuryAta: solPrizeEscrow,
    //         creatorBidAta: solPrizeEscrow
    //     });


    //     // POST-COMPLETE BALANCES
    //     const afterCompleteAuctionSol = await getSolBalance(solAuctionPda);
    //     const afterCompleteConfigSol = await getSolBalance(configPda);
    //     const afterCompleteCreatorSol = await getSolBalance(auction_1_creator.publicKey);
    //     const afterPrizeEscrowBal = await getTokenBalance(solPrizeEscrow);
    //     const afterWinnerPrizeBal = await getTokenBalance(winnerPrizeAta);

    //     console.log("\n---- AFTER COMPLETE ----");
    //     console.log("Auction PDA SOL:", afterCompleteAuctionSol,
    //         " (payout:", beforeCompleteAuctionSol - afterCompleteAuctionSol, ")");
    //     console.log("Config PDA SOL:", afterCompleteConfigSol,
    //         " (fee received:", afterCompleteConfigSol - beforeCompleteConfigSol, ")");
    //     console.log("Creator SOL:", afterCompleteCreatorSol,
    //         " (creator received:", afterCompleteCreatorSol - beforeCompleteCreatorSol, ")");

    //     console.log("Prize Escrow NFT:", afterPrizeEscrowBal, " (should be 0)");
    //     console.log("Winner Prize ATA:", afterWinnerPrizeBal, " (should be 1)");

    // });

    it("SPL Auction – 3 Bidders, Bidder-3 Wins", async () => {
        console.log("\n================ SPL AUCTION – 3 BIDDERS ================");

        const bidder1 = Keypair.generate();
        const bidder2 = Keypair.generate();
        const bidder3 = Keypair.generate();

        for (const kp of [bidder1, bidder2, bidder3]) {
            await context.setAccount(kp.publicKey, {
                lamports: 10_000_000_000,
                owner: SystemProgram.programId,
                executable: false,
                data: Buffer.alloc(0),
            });
        }

        // Create ATAs
        const bidder1Ata = await createAta(splBidMint, bidder1.publicKey);
        const bidder2Ata = await createAta(splBidMint, bidder2.publicKey);
        const bidder3Ata = await createAta(splBidMint, bidder3.publicKey);

        // Mint tokens to each bidder
        await mintTokens(splBidMint, bidder1Ata, 200_000_000_000); // 200 tokens
        await mintTokens(splBidMint, bidder2Ata, 200_000_000_000);
        await mintTokens(splBidMint, bidder3Ata, 200_000_000_000);

        const balances = async () => ({
            b1: await getTokenBalance(bidder1Ata),
            b2: await getTokenBalance(bidder2Ata),
            b3: await getTokenBalance(bidder3Ata),
            escrow: await getTokenBalance(splBidEscrow)
        });

        console.log("\n---- INITIAL BALANCES ----");
        console.log(await balances());

        // BID #1 — Bidder-1 bids 20 tokens
        console.log("\n---- BID #1 (Bidder-1 bids 20 tokens) ----");

        await placeBid(program, {
            auctionId: splAuctionId,
            bidder: bidder1,
            auctionAdmin: auction_admin,
            bidAmount: 20_000_000_000, // 20 tokens
            bidMint: splBidMint,
            bidderAta: bidder1Ata,
            prevBidder: PublicKey.unique(),
            prevBidderAta: bidder1Ata,
            bidEscrow: splBidEscrow,
        });

        console.log(await balances());

        // BID #2 — Bidder-2 bids 25 tokens
        console.log("\n---- BID #2 (Bidder-2 bids 25 tokens, outbids B1) ----");

        await placeBid(program, {
            auctionId: splAuctionId,
            bidder: bidder2,
            auctionAdmin: auction_admin,
            bidAmount: 25_000_000_000,
            bidMint: splBidMint,
            bidderAta: bidder2Ata,
            prevBidder: bidder1.publicKey,
            prevBidderAta: bidder1Ata,
            bidEscrow: splBidEscrow,
        });

        console.log(await balances());

        // BID #3 — Bidder-1 bids again (30 tokens)
        console.log("\n---- BID #3 (Bidder-1 re-bids 30 tokens, outbids B2) ----");

        await placeBid(program, {
            auctionId: splAuctionId,
            bidder: bidder1,
            auctionAdmin: auction_admin,
            bidAmount: 30_000_000_000,
            bidMint: splBidMint,
            bidderAta: bidder1Ata,
            prevBidder: bidder2.publicKey,
            prevBidderAta: bidder2Ata,
            bidEscrow: splBidEscrow,
        });

        console.log(await balances());

        // BID #4 — Bidder-3 bids final highest (40 tokens)
        console.log("\n---- BID #4 (Bidder-3 bids 40 tokens, final highest) ----");

        await placeBid(program, {
            auctionId: splAuctionId,
            bidder: bidder3,
            auctionAdmin: auction_admin,
            bidAmount: 40_000_000_000,
            bidMint: splBidMint,
            bidderAta: bidder3Ata,
            prevBidder: bidder1.publicKey,
            prevBidderAta: bidder1Ata,
            bidEscrow: splBidEscrow,
        });

        console.log(await balances());

        console.log("\n---- BID #1 try with little amount of increment ----");
        await assert.rejects(
            placeBid(program, {
                auctionId: splAuctionId,
                bidder: bidder1,
                auctionAdmin: auction_admin,
                bidAmount: 40_000_000_001,
                bidMint: splBidMint,
                bidderAta: bidder1Ata,
                prevBidder: bidder3.publicKey,
                prevBidderAta: bidder3Ata,
                bidEscrow: splBidEscrow,
            })
        );

        // WINNER IS BIDDER-3
        console.log("\n---- WINNER IS BIDDER-3 ----");

        await warpForward(10000); // exceed auction end time

        const winnerPrizeAta = await createAta(splPrizeMint, bidder3.publicKey);
        const bidFeeTreasuryAta = await createAta(splBidMint, auctionConfigPda());
        const creatorBidAta = await createAta(splBidMint, auction_2_creator.publicKey);

        const before = {
            auction: await getTokenBalance(splBidEscrow),
            config: await getTokenBalance(bidFeeTreasuryAta),
            creatorPrize: await getTokenBalance(splCreatorPrizeAta),
            creatorBid: await getTokenBalance(creatorBidAta),
            escrowNFT: await getTokenBalance(splPrizeEscrow),
            winnerNFT: await getTokenBalance(winnerPrizeAta)
        };

        console.log("\n---- BEFORE COMPLETE ----");
        console.log(before);

        await completeAuction(program, {
            auctionId: splAuctionId,
            auctionAdmin: auction_admin,
            creator: auction_2_creator.publicKey,
            winner: bidder3.publicKey,

            prizeMint: splPrizeMint,
            bidMint: splBidMint,
            prizeEscrow: splPrizeEscrow,
            bidEscrow: splBidEscrow,

            creatorPrizeAta: splCreatorPrizeAta,
            winnerPrizeAta: winnerPrizeAta,

            bidFeeTreasuryAta: bidFeeTreasuryAta, // config-owned ATA
            creatorBidAta: creatorBidAta,             // creator receiving SPL revenue
        });

        const after = {
            auction: await getTokenBalance(splBidEscrow),
            config: await getTokenBalance(bidFeeTreasuryAta),
            creatorPrize: await getTokenBalance(splCreatorPrizeAta),
            creatorBid: await getTokenBalance(creatorBidAta),
            escrowNFT: await getTokenBalance(splPrizeEscrow),
            winnerNFT: await getTokenBalance(winnerPrizeAta)
        };

        console.log("\n---- AFTER COMPLETE ----");
        console.log(after);

        console.log("\n---- EXPECTED MOVEMENTS ----");
        console.log("Winner paid: 40 tokens");
        console.log("Previous bidders refunded properly:");
        console.log("- Bidder-1 refunded after Bidder-2 and Bidder-3");
        console.log("- Bidder-2 refunded after Bidder-1's second bid");
        console.log("NFT moved to Bidder-3");
        console.log("Auction escrow closed");

        console.log("\n---- BID #1 try after completion fails ----");

        await assert.rejects(
            placeBid(program, {
                auctionId: splAuctionId,
                bidder: bidder1,
                auctionAdmin: auction_admin,
                bidAmount: 50_000_000_000,
                bidMint: splBidMint,
                bidderAta: bidder1Ata,
                prevBidder: bidder3.publicKey,
                prevBidderAta: bidder3Ata,
                bidEscrow: splBidEscrow,
            })
        );

        console.log("------- After completion Config owner claims the fees ---------");

        const configPda = auctionConfigPda();
        const configOwner = auction_owner;          // MUST match auction_config.auction_owner
        const feeMint = splBidMint;                 // SPL mint used for bidding
        const amountToWithdraw = 400_000_000;       // 0.4 tokens for example

        // PDA ATA owned by auction_config PDA holding fee tokens
        const feeTreasuryAta = await createAta(feeMint, configPda);

        // Owner’s receiving ATA
        const ownerFeeAta = await createAta(feeMint, configOwner.publicKey);

        // PRE BALANCES
        const beforeTreasury = await getTokenBalance(feeTreasuryAta);
        const beforeOwner = await getTokenBalance(ownerFeeAta);

        console.log("Before Withdraw - Treasury:", beforeTreasury);
        console.log("Before Withdraw - Owner   :", beforeOwner);

        // WITHDRAW FEES
        await program.methods
            .withdrawSplFees(new anchor.BN(amountToWithdraw))
            .accounts({
                auctionConfig: configPda,
                owner: configOwner.publicKey,
                feeMint: feeMint,
                feeTreasuryAta: feeTreasuryAta,
                receiverFeeAta: ownerFeeAta,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
            })
            .signers([configOwner])       // owner must sign
            .rpc();

        // POST BALANCES
        const afterTreasury = await getTokenBalance(feeTreasuryAta);
        const afterOwner = await getTokenBalance(ownerFeeAta);

        console.log("\nAfter Withdraw - Treasury:", afterTreasury);
        console.log("After Withdraw - Owner   :", afterOwner);

        console.log("Transferred:", beforeTreasury - afterTreasury);

    });

});
