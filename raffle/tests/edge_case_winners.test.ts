import assert from "assert";
import * as anchor from "@coral-xyz/anchor";
import { startAnchor } from "solana-bankrun";
import { BankrunProvider } from "anchor-bankrun";
import { Keypair, PublicKey } from "@solana/web3.js";

import {
    createRaffleConfig,
    createSplMint,
    createRaffle,
    buildCreateRaffleAccounts,
    mintTokens,
    createAta,
    getCurrentTimestamp,
    getTokenBalance,
    getSolBalance,
    announceWinners,
    buyTickets,
    warpForward,
    buyerClaimPrize,
    buyerPda,
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

describe("Edge case Announce Winners – setup", () => {
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
        //  - startTime in now, autoStart = true (immediately activate)
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
                numWinners: 4,
                winShares: [40, 30, 20, 10],
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
        const start = now;     // future
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
                numWinners: 4,
                winShares: [40, 30, 20, 10],
                unique: true,
                autoStart: true,         // need explicit activateRaffle later
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

    it("Edge-case: Only 2 winners although numWinners = 4 → buyers claim their prizes, leftover prize returns to creator", async () => {
        console.log("\n================= EDGE CASE: LIMITED WINNERS =================");

        const raffle = splRaffle;   // we run SPL raffle version so claim-back logic applies
        const {
            raffleId,
            rafflePda,
            ticketMint,
            prizeMint,
            ticketEscrow,
            prizeEscrow,
            creatorPrizeAta,
            ticketFeeTreasury,
        } = raffle;

        // -------------------------------------------------------------
        // STEP 1: Create & Fund ONLY 2 buyers
        // -------------------------------------------------------------
        const buyers = Array.from({ length: 2 }, () => Keypair.generate());

        for (const buyer of buyers) {
            await context.setAccount(buyer.publicKey, {
                lamports: 20_000_000_000,
                owner: anchor.web3.SystemProgram.programId,
                executable: false,
                data: Buffer.alloc(0),
            });
        }

        console.log("\nBuyers:", buyers.map(b => b.publicKey.toBase58()));

        // -------------------------------------------------------------
        // STEP 2: Create ticket ATAs & mint SPL to buyers
        // -------------------------------------------------------------
        const buyerTicketAtas: PublicKey[] = [];

        for (const buyer of buyers) {
            const ata = await createAta(ticketMint, buyer.publicKey);
            buyerTicketAtas.push(ata);

            await mintTokens(ticketMint, ata, 1_000_000_000_000);
        }

        console.log("Buyer ticket ATAs funded.");

        // -------------------------------------------------------------
        // STEP 3: Buyers buy tickets
        // buyer-1 buys 3 tickets
        // buyer-2 buys 1 ticket
        // -------------------------------------------------------------
        await buyTickets(
            program, rafflePda, raffleId,
            buyers[0], 3, ticketMint, ticketEscrow, buyerTicketAtas[0], raffle_admin
        );

        await buyTickets(
            program, rafflePda, raffleId,
            buyers[1], 1, ticketMint, ticketEscrow, buyerTicketAtas[1], raffle_admin
        );

        console.log("Tickets purchased: buyer1=3, buyer2=1");

        // -------------------------------------------------------------
        // STEP 4: Warp beyond end time
        // -------------------------------------------------------------
        await warpForward(20_000);

        // -------------------------------------------------------------
        // STEP 5: Winners (only 2 winners but numWinners=4)
        // Winner index mapping:
        // 0 → 40% (buyer1)
        // 1 → 30% (buyer2)
        // 2 → 20% (NO WINNER → goes to creator)
        // 3 → 10% (NO WINNER → goes to creator)
        // -------------------------------------------------------------
        const winners = [
            buyers[0].publicKey,
            buyers[1].publicKey
            // Missing 2 winners – edge case handled
        ];

        console.log("\nProvided Winners:", winners.map(w => w.toBase58()));

        const escrowBeforeAnnounce = await getTokenBalance(prizeEscrow);

        console.log("\nPrize Escrow Before Announce:", escrowBeforeAnnounce);


        let raffle_acc = await program.account.raffle.fetch(rafflePda);
        console.log(raffle_acc);
        let buyer_1 = await program.account.buyer.fetch(buyerPda(raffle_acc.raffleId, buyers[0].publicKey, program.programId));
        console.log(buyer_1)
        let buyer_2 = await program.account.buyer.fetch(buyerPda(raffle_acc.raffleId, buyers[1].publicKey, program.programId));
        console.log(buyer_2)

        await announceWinners(
            program,
            rafflePda,
            raffleId,
            raffle_admin,
            winners,          // ONLY 2 winners
            ticketMint,
            ticketEscrow,
            ticketFeeTreasury
        );

        let raffleAcc = await program.account.raffle.fetch(rafflePda);

        console.log("\n=== After Announce Winners ===");
        console.log("Winners array stored:", raffleAcc.winners.map(w => w.toBase58()));
        console.log("is_win_claimed:", raffleAcc.isWinClaimed);
        console.log("Remaining PRIZE BACK:", raffleAcc.claimablePrizeBack.toNumber());
        console.log("Remaining TICKET BACK:", raffleAcc.claimableTicketAmount.toNumber());

        // -------------------------------------------------------------
        // STEP 6: Buyer ATAs for claiming SPL prize
        // -------------------------------------------------------------
        const buyer1PrizeAta = await createAta(prizeMint, buyers[0].publicKey);
        const buyer2PrizeAta = await createAta(prizeMint, buyers[1].publicKey);

        const b1Before = await getTokenBalance(buyer1PrizeAta);
        const b2Before = await getTokenBalance(buyer2PrizeAta);

        console.log("\nBuyer1 Prize Before:", b1Before);
        console.log("Buyer2 Prize Before:", b2Before);

        // -------------------------------------------------------------
        // STEP 7: Buyers claim SPL prizes
        // -------------------------------------------------------------
        await buyerClaimPrize(program, rafflePda, raffleId, buyers[0], raffle_admin, prizeMint, prizeEscrow, buyer1PrizeAta);

        await buyerClaimPrize(program, rafflePda, raffleId, buyers[1], raffle_admin, prizeMint, prizeEscrow, buyer2PrizeAta);

        const b1After = await getTokenBalance(buyer1PrizeAta);
        const b2After = await getTokenBalance(buyer2PrizeAta);

        const escrowAfterBuyerClaims = await getTokenBalance(prizeEscrow);

        console.log("\n=== After Buyer Claims ===");
        console.log("Buyer1 Prize Increase:", b1After - b1Before);
        console.log("Buyer2 Prize Increase:", b2After - b2Before);
        console.log("Prize Escrow After Buyer Claims:", escrowAfterBuyerClaims);

        // -------------------------------------------------------------
        // STEP 8: Creator claims leftover prize (indexes 2 & 3)
        // -------------------------------------------------------------
        const creatorPrizeBefore = await getTokenBalance(creatorPrizeAta);

        const creatorTicketAta = await createAta(ticketMint, raffle_1_creator.publicKey);
        const creatorTicketBefore = await getTokenBalance(creatorTicketAta);
        const creatorSolBefore = await getSolBalance(raffle_1_creator.publicKey);

        console.log("\nCreator Prize Before:", creatorPrizeBefore);
        console.log("Creator Ticket Before:", creatorTicketBefore);
        console.log("Creator SOL Before:", creatorSolBefore);

        await program.methods
            .claimAmountBack(raffleId)
            .accounts({
                raffleConfig: raffleConfigPda(),
                raffle: rafflePda,
                creator: raffle_1_creator.publicKey,
                raffleAdmin: raffle_admin.publicKey,
                prizeMint,
                ticketMint,
                prizeEscrow,
                ticketEscrow,
                creatorPrizeAta,
                creatorTicketAta,
                prizeTokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
                ticketTokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
                systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([raffle_1_creator, raffle_admin])
            .rpc();

        const creatorPrizeAfter = await getTokenBalance(creatorPrizeAta);
        const creatorTicketAfter = await getTokenBalance(creatorTicketAta);
        const creatorSolAfter = await getSolBalance(raffle_1_creator.publicKey);

        let ticketEscrowFinal = 0;
        try {
            ticketEscrowFinal = await getTokenBalance(ticketEscrow);
        } catch (_) {
            ticketEscrowFinal = 0; // closed ATA
        }

        raffleAcc = await program.account.raffle.fetch(rafflePda);

        console.log("\n=========== FINAL RESULTS (CREATOR CLAIM BACK) ===========");
        console.log("Creator SPL Prize Gain:", creatorPrizeAfter - creatorPrizeBefore);
        console.log("Creator Ticket SPL Gain:", creatorTicketAfter - creatorTicketBefore);
        console.log("Creator SOL Gain:", creatorSolAfter - creatorSolBefore);
        console.log("Remaining Prize Escrow:", escrowAfterBuyerClaims);
        console.log("Ticket Escrow After ClaimBack:", ticketEscrowFinal);
        console.log("Raffle Claimable PrizeBack:", raffleAcc.claimablePrizeBack.toNumber());
        console.log("Raffle Claimable TicketBack:", raffleAcc.claimableTicketAmount.toNumber());
        console.log("============================================================\n");
    });

});