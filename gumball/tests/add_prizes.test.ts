import assert from "assert";
import * as anchor from "@coral-xyz/anchor";
import { startAnchor, Clock } from "solana-bankrun";
import { BankrunProvider } from "anchor-bankrun";

import {
    createSplMint,
    createNftMint,
    createAta,
    initializeGumballConfig,
    createGumball,
    activateGumball,
    buildCreateGumballAccounts,
    mintTokens,
    getTokenBalance,
    getSolBalance,
    getCurrentTimestamp,
    addPrize,
    warpForward,
    claimPrizeBack,
    spinGumball,
    endGumball,
} from "./helpers";

import {
    setProgram,
    setProvider,
    gumball_owner,
    gumball_admin,
    gumball_1_creator,
    gumball_2_creator,
    gumballConfigPda,
    gumballPda,
    creation_fee_lamports,
    ticket_fee_bps,
    minimum_Gumball_period,
    maximum_Gumball_period,
    gumballPrizePda,
} from "./values";

import { Gumball } from "../target/types/gumball";
import { PublicKey } from "@solana/web3.js";
import { generateKeyPair } from "crypto";

describe("Add prizes", () => {
    let context: any;
    let provider: BankrunProvider;
    let program: anchor.Program<Gumball>;

    // Gumball A: Ticket SOL
    let gumballA_id: number;
    let gumballA_pda: anchor.web3.PublicKey;
    let ticketMint_A: anchor.web3.PublicKey;

    // Gumball B: Ticket SPL
    let gumballB_id: number;
    let gumballB_pda: anchor.web3.PublicKey;
    let ticketMint_B: anchor.web3.PublicKey;

    async function fund(kp) {
        await context.setAccount(kp.publicKey, {
            lamports: 50_000_000_000,
            owner: anchor.web3.SystemProgram.programId,
            data: Buffer.alloc(0),
            executable: false,
        });
    }

    before(async () => {
        context = await startAnchor("", [], []);
        provider = new BankrunProvider(context);
        anchor.setProvider(provider);
        setProvider(provider);

        program = anchor.workspace.Gumball as anchor.Program<Gumball>;
        setProgram(program);

        // FUND ACCOUNTS
        await fund(gumball_owner);
        await fund(gumball_1_creator);
        await fund(gumball_2_creator);

        // Initialize config
        await initializeGumballConfig(
            gumball_owner,
            gumball_owner.publicKey,
            gumball_admin.publicKey,
            creation_fee_lamports,
            ticket_fee_bps,
            minimum_Gumball_period,
            maximum_Gumball_period
        );

        // Create Gumball A → Ticket mint = SOL
        const cfgA = await program.account.gumballConfig.fetch(gumballConfigPda());
        gumballA_id = cfgA.gumballCount;
        gumballA_pda = gumballPda(gumballA_id);
        ticketMint_A = await createSplMint(9);

        const nowA = await getCurrentTimestamp();
        const endA = nowA + minimum_Gumball_period + 200;

        await createGumball(
            {
                startTime: nowA + 100,
                endTime: endA,
                totalTickets: 20,
                ticketPrice: 1_000_000_000,  // 1 sol
                isTicketSol: true,
                startGumball: false,
            },
            {
                gumballPda: gumballA_pda,
                creator: gumball_1_creator,
                gumballAdmin: gumball_admin,
                ticketMint: ticketMint_A,
            }
        );
        const gumball_A = await program.account.gumballMachine.fetch(gumballA_pda);
        console.log(gumball_A);

        // Create Gumball B → Ticket mint = SPL token
        const cfgB = await program.account.gumballConfig.fetch(gumballConfigPda());
        gumballB_id = cfgB.gumballCount;
        gumballB_pda = gumballPda(gumballB_id);
        ticketMint_B = await createSplMint(9);

        const nowB = await getCurrentTimestamp();
        const endB = nowB + minimum_Gumball_period + 200;

        await createGumball(
            {
                startTime: nowB + 200,
                endTime: endB,
                totalTickets: 10,
                ticketPrice: 1_000_000_000,
                isTicketSol: false,
                startGumball: true,
            },
            {
                gumballPda: gumballB_pda,
                creator: gumball_2_creator,
                gumballAdmin: gumball_admin,
                ticketMint: ticketMint_B,
            }
        );
        const gumball_B = await program.account.gumballMachine.fetch(gumballB_pda);
        console.log(gumball_B);
    });

    async function prizeAccounts(gumballPda, creator, prizeMint) {
        const { prizeEscrow, creatorPrizeAta } = await buildCreateGumballAccounts(
            gumballPda,
            creator,
            prizeMint
        );
        return { prizeEscrow, creatorPrizeAta };
    }

    async function logSol(label: string, config: PublicKey, gumball: PublicKey, creator: PublicKey, spinner: PublicKey) {
        const c = await getSolBalance(config);
        const g = await getSolBalance(gumball);
        const cr = await getSolBalance(creator);
        const sp = await getSolBalance(spinner);

        console.log(label, {
            config: Number(c),
            gumball: Number(g),
            creator: Number(cr),
            spinner: Number(sp),
        });
    }

    async function logSpl(label: string, escrow: PublicKey, spinnerAta: PublicKey, ticketEscrow: PublicKey, feeEscrow: PublicKey, creatorTicketAta: PublicKey) {
        const e = await getTokenBalance(escrow);
        const s = await getTokenBalance(spinnerAta);
        const t = ticketEscrow ? await getTokenBalance(ticketEscrow) : 0;
        const f = feeEscrow ? await getTokenBalance(feeEscrow) : 0;
        const ct = creatorTicketAta ? await getTokenBalance(creatorTicketAta) : 0;

        console.log(label, {
            prizeEscrow: e,
            spinnerPrize: s,
            ticketEscrow: t,
            feeEscrow: f,
            creatorTicket: ct,
        });
    }

    async function logBalances(label: string, ata: PublicKey, escrow: PublicKey) {
        const c = await getTokenBalance(ata);
        const e = await getTokenBalance(escrow);
        console.log(label, "creator:", c, "escrow:", e);
    }

    it("adds multiple SPL prizes + spins + end game", async () => {

        const spl1 = await createSplMint();
        const spl2 = await createSplMint();

        const { prizeEscrow: esc1, creatorPrizeAta: ata1 } = await prizeAccounts(
            gumballA_pda,
            gumball_1_creator,
            spl1
        );
        const { prizeEscrow: esc2, creatorPrizeAta: ata2 } = await prizeAccounts(
            gumballA_pda,
            gumball_1_creator,
            spl2
        );

        await mintTokens(spl1, ata1, 100_000_000_000);
        await mintTokens(spl2, ata2, 100_000_000_000);

        await logBalances("initial spl1:", ata1, esc1);
        await logBalances("initial spl2:", ata2, esc2);

        // add prize 1
        await addPrize(gumballA_pda, gumballA_id, 2, 10_000_000_000, 3, gumball_1_creator, gumball_admin, spl1, esc1, ata1);
        await logBalances("after spl1 add1:", ata1, esc1);

        // add prize 2
        await addPrize(gumballA_pda, gumballA_id, 3, 5_000_000_000, 3, gumball_1_creator, gumball_admin, spl2, esc2, ata2);
        await logBalances("after spl2 add1:", ata2, esc2);

        // additional spl1 prizes
        await addPrize(gumballA_pda, gumballA_id, 2, 10_000_000_000, 2, gumball_1_creator, gumball_admin, spl1, esc1, ata1);
        await logBalances("after spl1 add2:", ata1, esc1);

        // wrong amount rejected
        await assert.rejects(addPrize(gumballA_pda, gumballA_id, 2, 1_000_000_000, 2, gumball_1_creator, gumball_admin, spl1, esc1, ata1));

        // SPINNER
        const spinner1 = anchor.web3.Keypair.generate();
        const spinner_1_ata = await createAta(spl1, spinner1.publicKey);
        await fund(spinner1);

        // cannot spin before activation
        await assert.rejects(
            spinGumball(gumballA_pda, gumballA_id, 2, spinner1, gumball_admin,
                spl1, esc1,
                spinner_1_ata,
                spl1, spinner_1_ata, spinner_1_ata)
        );

        await warpForward(500);
        await activateGumball(gumballA_pda, gumballA_id, gumball_admin);

        // ---------- BEFORE SPIN ----------
        console.log("--------- BEFORE SPIN ---------");
        await logSol("sol before spin:", gumballConfigPda(), gumballA_pda, gumball_1_creator.publicKey, spinner1.publicKey);
        await logSpl("spl before spin:", esc1, spinner_1_ata, null, null, null);

        // spin twice
        await spinGumball(gumballA_pda, gumballA_id, 2, spinner1, gumball_admin,
            spl1, esc1, spinner_1_ata,
            spl1, spinner_1_ata, spinner_1_ata);

        await spinGumball(gumballA_pda, gumballA_id, 2, spinner1, gumball_admin,
            spl1, esc1, spinner_1_ata,
            spl1, spinner_1_ata, spinner_1_ata);

        // ---------- AFTER SPIN ----------
        console.log("--------- AFTER SPIN ---------");
        await logSol("sol after spin:", gumballConfigPda(), gumballA_pda, gumball_1_creator.publicKey, spinner1.publicKey);
        await logSpl("spl after spin:", esc1, spinner_1_ata, null, null, null);

        // creator adds more prizes
        await addPrize(gumballA_pda, gumballA_id, 4, 1_000_000_000, 2, gumball_1_creator, gumball_admin, spl1, esc1, ata1);
        await logBalances("after spl1 add3:", ata1, esc1);

        // can't claim before cancel/end
        await assert.rejects(claimPrizeBack(gumballA_pda, gumballA_id, 2, gumball_1_creator, gumball_admin, spl1, esc1, ata1));

        // cannot end before time
        await assert.rejects(
            endGumball(gumballA_pda, gumballA_id, gumball_admin, gumball_1_creator.publicKey, ticketMint_A, esc1, esc1, esc1)
        );

        await warpForward(10000);

        // ---------- BEFORE END ----------
        console.log("--------- BEFORE END ---------");
        await logSol("sol before end:", gumballConfigPda(), gumballA_pda, gumball_1_creator.publicKey, spinner1.publicKey);

        await endGumball(gumballA_pda, gumballA_id, gumball_admin, gumball_1_creator.publicKey, ticketMint_A, esc1, esc1, esc1);

        // ---------- AFTER END ----------
        console.log("--------- AFTER END ---------");
        await logSol("sol after end:", gumballConfigPda(), gumballA_pda, gumball_1_creator.publicKey, spinner1.publicKey);

        // cannot spin after ending
        await assert.rejects(
            spinGumball(gumballA_pda, gumballA_id, 2, spinner1, gumball_admin,
                spl1, esc1, spinner_1_ata, spl1, spinner_1_ata, spinner_1_ata)
        );

        await logPrizeBackBalances(
            "Before Claim",
            ata1,      // creator_prize_ata
            esc1,      // prize_escrow
            gumball_1_creator
        );

        // after ending claim full prizes back
        await claimPrizeBack(
            gumballA_pda,
            gumballA_id,
            2,
            gumball_1_creator,
            gumball_admin,
            spl1,
            esc1,
            ata1
        )

        await logPrizeBackBalances(
            "After Claim",
            ata1,
            esc1,
            gumball_1_creator
        );
    });

    async function logPrizeBackBalances(label, creatorAta, escrow, creator) {
        const creatorBal = await getTokenBalance(creatorAta);
        const escrowBal = await getTokenBalance(escrow);
        const solBal = await getSolBalance(creator.publicKey);

        console.log(`\n===== ${label} =====`);
        console.log("Creator ATA:", creatorBal.toString());
        console.log("Prize Escrow:", escrowBal.toString());
        console.log("Creator SOL:", solBal.toString());
    }

    // it("adds 2 different NFT prizes to Gumball A", async () => {
    //     const nft1 = await createNftMint();
    //     const nft2 = await createNftMint();

    //     const { prizeEscrow: esc1, creatorPrizeAta: ata1 } = await prizeAccounts(
    //         gumballA_pda,
    //         gumball_1_creator,
    //         nft1
    //     );
    //     const { prizeEscrow: esc2, creatorPrizeAta: ata2 } = await prizeAccounts(
    //         gumballA_pda,
    //         gumball_1_creator,
    //         nft2
    //     );

    //     await mintTokens(nft1, ata1, 1);
    //     await mintTokens(nft2, ata2, 1);

    //     await logBalances("before nft1 add:", ata1, esc1);

    //     await addPrize(
    //         gumballA_pda,
    //         gumballA_id,
    //         0,
    //         1,
    //         1,
    //         gumball_1_creator,
    //         gumball_admin,
    //         nft1,
    //         esc1,
    //         ata1
    //     );

    //     await logBalances("after nft1 add:", ata1, esc1);


    //     await logBalances("before nft2 add:", ata2, esc2);

    //     await addPrize(
    //         gumballA_pda,
    //         gumballA_id,
    //         1,
    //         1,
    //         1,
    //         gumball_1_creator,
    //         gumball_admin,
    //         nft2,
    //         esc2,
    //         ata2
    //     );

    //     await logBalances("after nft2 add:", ata2, esc2);


    //     const p1 = await program.account.prize.fetch(gumballPrizePda(gumballA_id, 0));
    //     const p2 = await program.account.prize.fetch(gumballPrizePda(gumballA_id, 1));

    //     console.log("prize0:", p1);
    //     console.log("prize1:", p2);
    // });


});
