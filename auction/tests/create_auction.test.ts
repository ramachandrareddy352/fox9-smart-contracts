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
    updateAuction,
    warpForward,
    getTokenBalance,
    getSolBalance,
    cancelAuction,
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

    it("Update Auction Successfully (valid update before start + no bids)", async () => {
        // 1) Fetch config + determine auctionId
        const cfg = await program.account.auctionConfig.fetch(auctionConfigPda());
        const auctionId = cfg.auctionCount - 1;
        const auctionPda = await deriveAuctionPda(program, auctionId);

        // 2) Fetch existing auction
        let auctionBefore = await program.account.auction.fetch(auctionPda);

        console.log("Auction Before Update:");
        console.log({
            auctionId: auctionBefore.auctionId,
            startTime: Number(auctionBefore.startTime),
            endTime: Number(auctionBefore.endTime),
            baseBid: Number(auctionBefore.baseBid),
            minIncrement: Number(auctionBefore.minIncrement),
            timeExtension: auctionBefore.timeExtension,
            status: auctionBefore.status,
            hasAnyBid: auctionBefore.hasAnyBid,
        });

        // wrap time and test the function to reject
        // await warpForward(200);

        // 3) Calculate valid update values
        const now = await getCurrentTimestamp();
        const newStart = now + 120; // future start
        const newEnd = newStart + minimum_auction_period + 200;

        const newBaseBid = 5000000;
        const newMinIncrement = 20000;
        const newTimeExtension = minimum_time_extension + 30;

        // 4) Perform the update
        await updateAuction(program, {
            auctionId,
            creator: auction_1_creator,  // fix as per your setup
            auctionAdmin: auction_admin,
            startTime: newStart,
            endTime: newEnd,
            startImmediately: false,
            baseBid: newBaseBid,
            minIncrement: newMinIncrement,
            timeExtension: newTimeExtension,
        });

        // 5) Read updated auction
        const auctionAfter = await program.account.auction.fetch(auctionPda);

        console.log("\nAuction After Update:");
        console.log({
            auctionId: auctionAfter.auctionId,
            startTime: Number(auctionAfter.startTime),
            endTime: Number(auctionAfter.endTime),
            baseBid: Number(auctionAfter.baseBid),
            minIncrement: Number(auctionAfter.minIncrement),
            timeExtension: auctionAfter.timeExtension,
            highestBidAmount: Number(auctionAfter.highestBidAmount),
            status: auctionAfter.status,
            hasAnyBid: auctionAfter.hasAnyBid,
        });

        // 6) Diagnostic logs to verify correctness
        console.log("\nVerification Logs:");
        console.log("StartTime updated correctly:", Number(auctionAfter.startTime) === newStart);
        console.log("EndTime updated correctly:", Number(auctionAfter.endTime) === newEnd);
        console.log("BaseBid updated correctly:", Number(auctionAfter.baseBid) === newBaseBid);
        console.log("MinIncrement updated correctly:", Number(auctionAfter.minIncrement) === newMinIncrement);
        console.log("TimeExtension updated correctly:", auctionAfter.timeExtension === newTimeExtension);
        console.log("HighestBidAmount reset to baseBid:", Number(auctionAfter.highestBidAmount) === newBaseBid);
    });

    it("Cancel Auction Successfully – returns NFT to creator & closes accounts", async () => {
        // 1) Fetch config + determine auctionId
        const cfg = await program.account.auctionConfig.fetch(auctionConfigPda());
        const auctionId = cfg.auctionCount - 1;
        const auctionPda = await deriveAuctionPda(program, auctionId);

        // 2) Fetch existing accounts
        let auctionBefore = await program.account.auction.fetch(auctionPda);
        const creatorPrizeAta = await createAta(auctionBefore.prizeMint, auction_1_creator.publicKey);
        const prizeEscrow = await createAta(auctionBefore.prizeMint, auctionPda);

        // 3) Check initial balances
        const creatorNftBefore = await getTokenBalance(creatorPrizeAta);
        const escrowNftBefore = await getTokenBalance(prizeEscrow);
        const creatorSolBefore = await getSolBalance(auction_1_creator.publicKey);
        const configSolBefore = await getSolBalance(auctionConfigPda());

        console.log("Creator NFT Before:", creatorNftBefore);
        console.log("Escrow NFT Before:", escrowNftBefore);
        console.log("Creator SOL Before:", creatorSolBefore);
        console.log("Config SOL Before:", configSolBefore);

        // const fake_prize_mint = await createNftMint();

        // STEP 5: Cancel the Auction
        await cancelAuction(program, {
            auctionId,
            creator: auction_1_creator,
            auctionAdmin: auction_admin,
            prizeMint: auctionBefore.prizeMint,
            prizeEscrow,
            creatorPrizeAta,
        });

        console.log("--------- Auction cancelled successfully -------");

        // STEP 6: Verify final balances
        const creatorNftAfter = await getTokenBalance(creatorPrizeAta);
        let escrowNftAfter = 0;
        try {
            escrowNftAfter = await getTokenBalance(prizeEscrow);
        } catch (_) {
            escrowNftAfter = 0; // escrow closed
        }

        let auctionAccountExists = true;
        try {
            await program.account.auction.fetch(auctionPda);
        } catch (_) {
            auctionAccountExists = false; // closed
        }

        const creatorSolAfter = await getSolBalance(auction_1_creator.publicKey);
        const configSolAfter = await getSolBalance(auctionConfigPda());

        console.log("\n============== FINAL RESULTS ==============");
        console.log("Creator NFT Before:", creatorNftBefore);
        console.log("Creator NFT After:", creatorNftAfter);
        console.log("NFT Returned:", creatorNftAfter - creatorNftBefore);

        console.log("Escrow NFT Before:", escrowNftBefore);
        console.log("Escrow NFT After:", escrowNftAfter);
        console.log("Escrow Closed:", escrowNftAfter === 0);

        console.log("Auction Exists After:", auctionAccountExists);

        console.log("Creator SOL Before:", creatorSolBefore);
        console.log("Creator SOL After:", creatorSolAfter);
        console.log("Config SOL Before:", configSolBefore);
        console.log("Config SOL After:", configSolAfter);
        console.log("SOL Refund (Close Account Rent):", creatorSolAfter - creatorSolBefore);

        console.log("====================================================\n");
    });

    it("Config owner claim the sol fees", async () => {
        const cfgBefore = await getSolBalance(auctionConfigPda());
        const receiverBefore = await getSolBalance(auction_1_creator.publicKey);

        console.log("Config PDA SOL Before:", cfgBefore);
        console.log("Receiver SOL Before:", receiverBefore);

        const withdrawAmount = 99_000_000; // 0.1 < SOL

        console.log("\nWithdrawing:", withdrawAmount, "lamports");

        await program.methods
            .withdrawSolFees(new anchor.BN(withdrawAmount))
            .accounts({
                auctionConfig: auctionConfigPda(),
                owner: auction_owner.publicKey,
                receiver: auction_1_creator.publicKey,
                systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([auction_owner])
            .rpc();

        const cfgAfter = await getSolBalance(auctionConfigPda());
        const receiverAfter = await getSolBalance(auction_1_creator.publicKey);

        console.log("\n================= FINAL BALANCES =================");
        console.log("Config PDA SOL Before:", cfgBefore);
        console.log("Config PDA SOL After :", cfgAfter);
        console.log("Config PDA Decrease  :", cfgBefore - cfgAfter);

        console.log("Receiver SOL Before  :", receiverBefore);
        console.log("Receiver SOL After   :", receiverAfter);
        console.log("Receiver SOL Gained  :", receiverAfter - receiverBefore);
    });
});
