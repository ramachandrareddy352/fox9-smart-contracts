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
    createAta,
    getCurrentTimestamp,
    warpForward,
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
import { Keypair, PublicKey } from "@solana/web3.js";

describe("Buy raffle tickets", () => {
    let context: any;
    let provider: BankrunProvider;
    let program: anchor.Program<any>;

    let raffleIdSol: number, rafflePdaSol: anchor.web3.PublicKey, ticketMintSol: anchor.web3.PublicKey, prizeEscrowSol: anchor.web3.PublicKey, creatorPrizeAtaSol: anchor.web3.PublicKey, prizeMintSol: anchor.web3.PublicKey, ticketEscrowSol: anchor.web3.PublicKey;
    let raffleIdSpl: number, rafflePdaSpl: anchor.web3.PublicKey, ticketMintSpl: anchor.web3.PublicKey, prizeEscrowSpl: anchor.web3.PublicKey, creatorPrizeAtaSpl: anchor.web3.PublicKey, prizeMintSpl: anchor.web3.PublicKey, ticketEscrowSpl: anchor.web3.PublicKey;

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

        // Create SOL ticket & prize raffle, start immediately
        prizeMintSol = await createSplMint();
        ticketMintSol = await createSplMint(); // Dummy for accounts
        const cfgSol = await program.account.raffleConfig.fetch(raffleConfigPda());
        raffleIdSol = cfgSol.raffleCount;
        rafflePdaSol = rafflePda(raffleIdSol);

        const accountsSol = await buildCreateRaffleAccounts(rafflePdaSol, raffle_1_creator, ticketMintSol, prizeMintSol);
        ticketEscrowSol = accountsSol.ticketEscrow;
        prizeEscrowSol = accountsSol.prizeEscrow;
        creatorPrizeAtaSol = accountsSol.creatorPrizeAta;

        // For SOL prize, no mintTokens needed, assume transfer in createRaffle
        const nowSol = await getCurrentTimestamp();
        const startSol = nowSol;
        const endSol = nowSol + 10000;
        await createRaffle(program, {
            startTime: startSol,
            endTime: endSol,
            totalTickets: 10,
            ticketPrice: 100_000_000, // 0.1 SOL
            isTicketSol: true,
            maxPct: 20,
            prizeType: { sol: {} },
            prizeAmount: 1_000_000_000, // 1 SOL
            numWinners: 1,
            winShares: [100],
            unique: false,
            autoStart: true,
        }, {
            raffleConfig: raffleConfigPda(),
            rafflePda: rafflePdaSol,
            creator: raffle_1_creator,
            raffleAdmin: raffle_admin,
            ticketMint: ticketMintSol,
            prizeMint: prizeMintSol,
            ticketEscrow: ticketEscrowSol,
            prizeEscrow: prizeEscrowSol,
            creatorPrizeAta: creatorPrizeAtaSol,
        });

        // Create SPL ticket & prize raffle, start in future
        prizeMintSpl = await createSplMint();
        ticketMintSpl = await createSplMint();
        const cfgSpl = await program.account.raffleConfig.fetch(raffleConfigPda());
        raffleIdSpl = cfgSpl.raffleCount;
        rafflePdaSpl = rafflePda(raffleIdSpl);

        const accountsSpl = await buildCreateRaffleAccounts(rafflePdaSpl, raffle_2_creator, ticketMintSpl, prizeMintSpl);
        ticketEscrowSpl = accountsSpl.ticketEscrow;
        prizeEscrowSpl = accountsSpl.prizeEscrow;
        creatorPrizeAtaSpl = accountsSpl.creatorPrizeAta;

        await mintTokens(prizeMintSpl, creatorPrizeAtaSpl, 100_000_000_000);

        const nowSpl = await getCurrentTimestamp();
        const startSpl = nowSpl + 100;
        const endSpl = nowSpl + 10000;
        await createRaffle(program, {
            startTime: startSpl,
            endTime: endSpl,
            totalTickets: 10,
            ticketPrice: 100_000_000, // 0.1 tokens
            isTicketSol: false,
            maxPct: 20,
            prizeType: { spl: {} },
            prizeAmount: 1_000_000_000, // 1 token
            numWinners: 1,
            winShares: [100],
            unique: false,
            autoStart: false,
        }, {
            raffleConfig: raffleConfigPda(),
            rafflePda: rafflePdaSpl,
            creator: raffle_2_creator,
            raffleAdmin: raffle_admin,
            ticketMint: ticketMintSpl,
            prizeMint: prizeMintSpl,
            ticketEscrow: ticketEscrowSpl,
            prizeEscrow: prizeEscrowSpl,
            creatorPrizeAta: creatorPrizeAtaSpl,
        });
    });

    // Happy path for SOL ticket & SOL prize
    // it("successfully buys tickets for SOL raffle", async () => {
    //     const buyer = Keypair.generate();
    //     await context.setAccount(buyer.publicKey, {
    //         lamports: 20_000_000_000,
    //         owner: anchor.web3.SystemProgram.programId,
    //         executable: false,
    //         data: Buffer.alloc(0),
    //     });

    //     const buyerTicketAta = await createAta(ticketMintSol, buyer.publicKey); // Dummy ATA for SOL
    //     const raffleBefore = await program.account.raffle.fetch(rafflePdaSol);
    //     const ticketsToBuy = 2;
    //     const priceToPay = ticketsToBuy * Number(raffleBefore.ticketPrice);
    //     const raffleLamportsBefore = await getSolBalance(rafflePdaSol);

    //     await buyTickets(
    //         program,
    //         rafflePdaSol,
    //         raffleIdSol,
    //         buyer,
    //         ticketsToBuy,
    //         ticketMintSol,
    //         ticketEscrowSol,
    //         buyerTicketAta,
    //         raffle_admin
    //     );

    //     const raffleAfter = await program.account.raffle.fetch(rafflePdaSol);

    //     assert.equal(raffleAfter.ticketsSold, raffleBefore.ticketsSold + ticketsToBuy);

    //     const buyerAccountPda = PublicKey.findProgramAddressSync(
    //         [Buffer.from("raffle"), new anchor.BN(raffleIdSol).toArrayLike(Buffer, "le", 4), buyer.publicKey.toBuffer()],
    //         program.programId
    //     )[0];
    //     const buyerAccount = await program.account.buyer.fetch(buyerAccountPda);

    //     assert.equal(buyerAccount.tickets, ticketsToBuy);

    //     const raffleLamportsAfter = await getSolBalance(rafflePdaSol);
    //     console.log("raffleLamportsAfter => ", raffleLamportsAfter)
    //     assert.equal(raffleLamportsAfter - raffleLamportsBefore, priceToPay);
    // });

    // Happy path for SPL ticket & SPL prize (after starting)
    it("successfully buys tickets for SPL raffle after start time", async () => {
        await warpForward(200); // Move past start time

        await activateRaffle(program, rafflePdaSpl, raffleIdSpl, raffle_admin);

        const buyer = Keypair.generate();
        await context.setAccount(buyer.publicKey, {
            lamports: 20_000_000_000,
            owner: anchor.web3.SystemProgram.programId,
            executable: false,
            data: Buffer.alloc(0),
        });
        const buyerTicketAta = await createAta(ticketMintSpl, buyer.publicKey);
        await mintTokens(ticketMintSpl, buyerTicketAta, 100_000_000_000);

        const raffleBefore = await program.account.raffle.fetch(rafflePdaSpl);
        const ticketsToBuy = 2;
        const priceToPay = ticketsToBuy * Number(raffleBefore.ticketPrice);
        const escrowBalanceBefore = await getTokenBalance(ticketEscrowSpl);
        const buyerBalanceBefore = await getTokenBalance(buyerTicketAta);

        await buyTickets(
            program,
            rafflePdaSpl,
            raffleIdSpl,
            buyer,
            ticketsToBuy,
            ticketMintSpl,
            ticketEscrowSpl,
            buyerTicketAta,
            raffle_admin
        );

        const raffleAfter = await program.account.raffle.fetch(rafflePdaSpl);

        assert.strictEqual(raffleAfter.ticketsSold, raffleBefore.ticketsSold + ticketsToBuy);

        const buyerAccountPda = PublicKey.findProgramAddressSync(
            [Buffer.from("raffle"), new anchor.BN(raffleIdSpl).toArrayLike(Buffer, "le", 4), buyer.publicKey.toBuffer()],
            program.programId
        )[0];

        const buyerAccount = await program.account.buyer.fetch(buyerAccountPda);
        assert.strictEqual(buyerAccount.tickets, ticketsToBuy);

        const escrowBalanceAfter = await getTokenBalance(ticketEscrowSpl);
        const buyerBalanceAfter = await getTokenBalance(buyerTicketAta);

        assert.strictEqual(escrowBalanceAfter - escrowBalanceBefore, priceToPay);
        assert.strictEqual(buyerBalanceBefore - buyerBalanceAfter, priceToPay);
    });

    // // Fail if function paused (mutate pause_flags)
    // it("fails to buy if function paused", async () => {
    //     const config = await program.account.raffleConfig.fetch(raffleConfigPda());
    //     config.pauseFlags = 8;
    //     // Mutate account
    //     await context.setAccount(raffleConfigPda(), {
    //         data: program.coder.accounts.encode("raffleConfig", config),
    //         lamports: await getSolBalance(raffleConfigPda()),
    //         owner: program.programId,
    //         executable: false,
    //     });
    //     const buyer = Keypair.generate();
    //     await context.setAccount(buyer.publicKey, {
    //         lamports: 20_000_000_000,
    //         owner: anchor.web3.SystemProgram.programId,
    //         executable: false,
    //         data: Buffer.alloc(0),
    //     });
    //     const buyerTicketAta = await createAta(ticketMintSol, buyer.publicKey);
    //     await assert.rejects(async () => {
    //         await buyTickets(
    //             program,
    //             rafflePdaSol,
    //             raffleIdSol,
    //             buyer,
    //             1,
    //             ticketMintSol,
    //             ticketEscrowSol,
    //             buyerTicketAta,
    //             raffle_admin
    //         );
    //     });
    //     // Reset pause
    //     config.pauseFlags = 0;
    //     await context.setAccount(raffleConfigPda(), {
    //         data: program.coder.accounts.encode("raffleConfig", config),
    //         lamports: await getSolBalance(raffleConfigPda()),
    //         owner: program.programId,
    //         executable: false,
    //     });
    // });

    // // Fail if not active
    // it("fails to buy if raffle not active", async () => {
    //     // Use SPL raffle before activate
    //     const buyer = Keypair.generate();
    //     await context.setAccount(buyer.publicKey, {
    //         lamports: 20_000_000_000,
    //         owner: anchor.web3.SystemProgram.programId,
    //         executable: false,
    //         data: Buffer.alloc(0),
    //     });
    //     const buyerTicketAta = await createAta(ticketMintSpl, buyer.publicKey);
    //     await mintTokens(ticketMintSpl, buyerTicketAta, 100_000_000_000);
    //     await assert.rejects(async () => {
    //         await buyTickets(
    //             program,
    //             rafflePdaSpl,
    //             raffleIdSpl,
    //             buyer,
    //             1,
    //             ticketMintSpl,
    //             ticketEscrowSpl,
    //             buyerTicketAta,
    //             raffle_admin
    //         );
    //     });
    // });

    // // Fail if before start
    // it("fails to buy before start time", async () => {
    //     // For SPL raffle, before warp
    //     // But since we warped earlier, create a new one
    //     const prizeMintNew = await createSplMint();
    //     const cfgNew = await program.account.raffleConfig.fetch(raffleConfigPda());
    //     const raffleIdNew = cfgNew.raffleCount;
    //     const rafflePdaNew = rafflePda(raffleIdNew);
    //     const ticketMintNew = await createSplMint();
    //     const accountsNew = await buildCreateRaffleAccounts(rafflePdaNew, raffle_1_creator, ticketMintNew, prizeMintNew);
    //     await mintTokens(prizeMintNew, accountsNew.creatorPrizeAta, 100_000_000_000);
    //     const nowNew = await getCurrentTimestamp();
    //     const startNew = nowNew + 100;
    //     const endNew = nowNew + 10000;
    //     await createRaffle(program, {
    //         startTime: startNew,
    //         endNew: endNew,
    //         totalTickets: 10,
    //         ticketPrice: 100_000_000,
    //         isTicketSol: false,
    //         maxPct: 20,
    //         prizeType: { spl: {} },
    //         prizeAmount: 1_000_000_000,
    //         numWinners: 1,
    //         winShares: [100],
    //         unique: false,
    //         autoStart: false,
    //     }, {
    //         raffleConfig: raffleConfigPda(),
    //         rafflePda: rafflePdaNew,
    //         creator: raffle_1_creator,
    //         raffleAdmin: raffle_admin,
    //         ticketMint: ticketMintNew,
    //         prizeMint: prizeMintNew,
    //         ticketEscrow: accountsNew.ticketEscrow,
    //         prizeEscrow: accountsNew.prizeEscrow,
    //         creatorPrizeAta: accountsNew.creatorPrizeAta,
    //     });
    //     await activateRaffle(program, rafflePdaNew, raffleIdNew, raffle_admin);
    //     const buyer = Keypair.generate();
    //     await context.setAccount(buyer.publicKey, {
    //         lamports: 20_000_000_000,
    //         owner: anchor.web3.SystemProgram.programId,
    //         executable: false,
    //         data: Buffer.alloc(0),
    //     });
    //     const buyerTicketAta = await createAta(ticketMintNew, buyer.publicKey);
    //     await mintTokens(ticketMintNew, buyerTicketAta, 100_000_000_000);
    //     await assert.rejects(async () => {
    //         await buyTickets(
    //             program,
    //             rafflePdaNew,
    //             raffleIdNew,
    //             buyer,
    //             1,
    //             ticketMintNew,
    //             accountsNew.ticketEscrow,
    //             buyerTicketAta,
    //             raffle_admin
    //         );
    //     });
    // });

    // // Fail if after end
    // it("fails to buy after end time", async () => {
    //     await warpForward(context, 20000);
    //     const buyer = Keypair.generate();
    //     await context.setAccount(buyer.publicKey, {
    //         lamports: 20_000_000_000,
    //         owner: anchor.web3.SystemProgram.programId,
    //         executable: false,
    //         data: Buffer.alloc(0),
    //     });
    //     const buyerTicketAta = await createAta(ticketMintSol, buyer.publicKey);
    //     await assert.rejects(async () => {
    //         await buyTickets(
    //             program,
    //             rafflePdaSol,
    //             raffleIdSol,
    //             buyer,
    //             1,
    //             ticketMintSol,
    //             ticketEscrowSol,
    //             buyerTicketAta,
    //             raffle_admin
    //         );
    //     });
    // });

    // // Fail if 0 tickets
    // it("fails to buy 0 tickets", async () => {
    //     const buyer = Keypair.generate();
    //     await context.setAccount(buyer.publicKey, {
    //         lamports: 20_000_000_000,
    //         owner: anchor.web3.SystemProgram.programId,
    //         executable: false,
    //         data: Buffer.alloc(0),
    //     });
    //     const buyerTicketAta = await createAta(ticketMintSol, buyer.publicKey);
    //     await assert.rejects(async () => {
    //         await buyTickets(
    //             program,
    //             rafflePdaSol,
    //             raffleIdSol,
    //             buyer,
    //             0,
    //             ticketMintSol,
    //             ticketEscrowSol,
    //             buyerTicketAta,
    //             raffle_admin
    //         );
    //     });
    // });

    // // Fail if more than remaining

    // it("fails to buy more than remaining tickets", async () => {
    //     const raffle = await program.account.raffle.fetch(rafflePdaSol);
    //     const remaining = raffle.totalTickets - raffle.ticketsSold;
    //     const ticketsToBuy = remaining + 1;
    //     const buyer = Keypair.generate();
    //     await context.setAccount(buyer.publicKey, {
    //         lamports: 20_000_000_000,
    //         owner: anchor.web3.SystemProgram.programId,
    //         executable: false,
    //         data: Buffer.alloc(0),
    //     });
    //     const buyerTicketAta = await createAta(ticketMintSol, buyer.publicKey);

    //     await buyTickets(
    //         program,
    //         rafflePdaSol,
    //         raffleIdSol,
    //         buyer,
    //         ticketsToBuy,
    //         ticketMintSol,
    //         ticketEscrowSol,
    //         buyerTicketAta,
    //         raffle_admin
    //     );
    // });

    // // Fail if more than max per wallet
    // it("fails to buy more than max per wallet", async () => {
    //     const raffle = await program.account.raffle.fetch(rafflePdaSol);
    //     const maxPerWallet = Math.floor(raffle.totalTickets * (raffle.maxPerWalletPct / 100));
    //     const ticketsToBuy = maxPerWallet + 1;
    //     const buyer = Keypair.generate();
    //     await context.setAccount(buyer.publicKey, {
    //         lamports: 20_000_000_000,
    //         owner: anchor.web3.SystemProgram.programId,
    //         executable: false,
    //         data: Buffer.alloc(0),
    //     });
    //     const buyerTicketAta = await createAta(ticketMintSol, buyer.publicKey);
    //     await assert.rejects(async () => {
    //         await buyTickets(
    //             program,
    //             rafflePdaSol,
    //             raffleIdSol,
    //             buyer,
    //             ticketsToBuy,
    //             ticketMintSol,
    //             ticketEscrowSol,
    //             buyerTicketAta,
    //             raffle_admin
    //         );
    //     });
    // });

    // // Fail if wrong buyer account user (mutate)
    // it("fails if wrong buyer account user", async () => {
    //     const buyer = Keypair.generate();
    //     await context.setAccount(buyer.publicKey, {
    //         lamports: 20_000_000_000,
    //         owner: anchor.web3.SystemProgram.programId,
    //         executable: false,
    //         data: Buffer.alloc(0),
    //     });
    //     const buyerTicketAta = await createAta(ticketMintSol, buyer.publicKey);
    //     // First buy to create account
    //     await buyTickets(
    //         program,
    //         rafflePdaSol,
    //         raffleIdSol,
    //         buyer,
    //         1,
    //         ticketMintSol,
    //         ticketEscrowSol,
    //         buyerTicketAta,
    //         raffle_admin
    //     );
    //     const buyerAccountPda = PublicKey.findProgramAddressSync(
    //         [Buffer.from("raffle"), new anchor.BN(raffleIdSol).toArrayLike(Buffer, "le", 4), buyer.publicKey.toBuffer()],
    //         program.programId
    //     )[0];
    //     const buyerAccount = await program.account.buyer.fetch(buyerAccountPda);
    //     buyerAccount.user = Keypair.generate().publicKey; // Wrong user
    //     await context.setAccount(buyerAccountPda, {
    //         data: program.coder.accounts.encode("buyer", buyerAccount),
    //         lamports: await getSolBalance(buyerAccountPda),
    //         owner: program.programId,
    //         executable: false,
    //     });
    //     await assert.rejects(async () => {
    //         await buyTickets(
    //             program,
    //             rafflePdaSol,
    //             raffleIdSol,
    //             buyer,
    //             1,
    //             ticketMintSol,
    //             ticketEscrowSol,
    //             buyerTicketAta,
    //             raffle_admin
    //         );
    //     });
    // });

    // // Fail if wrong raffle_id in buyer account

    // it("fails if wrong raffle_id in buyer account", async () => {
    //     const buyer = Keypair.generate();
    //     await context.setAccount(buyer.publicKey, {
    //         lamports: 20_000_000_000,
    //         owner: anchor.web3.SystemProgram.programId,
    //         executable: false,
    //         data: Buffer.alloc(0),
    //     });
    //     const buyerTicketAta = await createAta(ticketMintSol, buyer.publicKey);
    //     // First buy
    //     await buyTickets(
    //         program,
    //         rafflePdaSol,
    //         raffleIdSol,
    //         buyer,
    //         1,
    //         ticketMintSol,
    //         ticketEscrowSol,
    //         buyerTicketAta,
    //         raffle_admin
    //     );
    //     const buyerAccountPda = PublicKey.findProgramAddressSync(
    //         [Buffer.from("raffle"), new anchor.BN(raffleIdSol).toArrayLike(Buffer, "le", 4), buyer.publicKey.toBuffer()],
    //         program.programId
    //     )[0];
    //     const buyerAccount = await program.account.buyer.fetch(buyerAccountPda);
    //     buyerAccount.raffleId = 999; // Wrong
    //     await context.setAccount(buyerAccountPda, {
    //         data: program.coder.accounts.encode("buyer", buyerAccount),
    //         lamports: await getSolBalance(buyerAccountPda),
    //         owner: program.programId,
    //         executable: false,
    //     });

    //     await buyTickets(
    //         program,
    //         rafflePdaSol,
    //         raffleIdSol,
    //         buyer,
    //         1,
    //         ticketMintSol,
    //         ticketEscrowSol,
    //         buyerTicketAta,
    //         raffle_admin
    //     );
    // });

    // // // For SPL: fail if mint mismatch
    // it("fails for SPL if mint mismatch", async () => {
    //     await warpForward(3000);

    //     await activateRaffle(program, rafflePdaSpl, raffleIdSpl, raffle_admin);

    //     const buyer = Keypair.generate();
    //     await context.setAccount(buyer.publicKey, {
    //         lamports: 20_000_000_000,
    //         owner: anchor.web3.SystemProgram.programId,
    //         executable: false,
    //         data: Buffer.alloc(0),
    //     });
    //     const wrongMint = await createSplMint();
    //     const buyerTicketAta = await createAta(wrongMint, buyer.publicKey);
    //     await mintTokens(wrongMint, buyerTicketAta, 100_000_000_000);

    //     await buyTickets(
    //         program,
    //         rafflePdaSpl,
    //         raffleIdSpl,
    //         buyer,
    //         1,
    //         wrongMint,
    //         ticketEscrowSpl,
    //         buyerTicketAta,
    //         raffle_admin
    //     );

    // });

    // For SPL: fail if ata owner mismatch
    // it("fails for SPL if buyer ata owner mismatch", async () => {
    //     const buyer = Keypair.generate();
    //     await context.setAccount(buyer.publicKey, {
    //         lamports: 20_000_000_000,
    //         owner: anchor.web3.SystemProgram.programId,
    //         executable: false,
    //         data: Buffer.alloc(0),
    //     });
    //     const wrongOwner = Keypair.generate();
    //     const buyerTicketAta = await createAta(ticketMintSpl, wrongOwner.publicKey);
    //     await mintTokens(ticketMintSpl, buyerTicketAta, 100_000_000_000);
    //     await buyTickets(
    //         program,
    //         rafflePdaSpl,
    //         raffleIdSpl,
    //         buyer,
    //         1,
    //         ticketMintSpl,
    //         ticketEscrowSpl,
    //         buyerTicketAta,
    //         raffle_admin
    //     );
    // });

    // For SPL: fail if escrow owner mismatch
    // it("fails for SPL if escrow owner mismatch", async () => {
    //     const buyer = Keypair.generate();
    //     await context.setAccount(buyer.publicKey, {
    //         lamports: 20_000_000_000,
    //         owner: anchor.web3.SystemProgram.programId,
    //         executable: false,
    //         data: Buffer.alloc(0),
    //     });
    //     const buyerTicketAta = await createAta(ticketMintSpl, buyer.publicKey);
    //     await mintTokens(ticketMintSpl, buyerTicketAta, 100_000_000_000);
    //     const wrongEscrow = await createAta(ticketMintSpl, Keypair.generate().publicKey);
    //     await buyTickets(
    //         program,
    //         rafflePdaSpl,
    //         raffleIdSpl,
    //         buyer,
    //         1,
    //         ticketMintSpl,
    //         wrongEscrow,
    //         buyerTicketAta,
    //         raffle_admin
    //     );
    // });

    // // Overflow in tickets sold
    // it("fails on overflow in tickets sold", async () => {
    //     const raffle = await program.account.raffle.fetch(rafflePdaSol);
    //     raffle.ticketsSold = raffle.totalTickets - 1;
    //     await context.setAccount(rafflePdaSol, {
    //         data: program.coder.accounts.encode("raffle", raffle),
    //         lamports: await getSolBalance(rafflePdaSol),
    //         owner: program.programId,
    //         executable: false,
    //     });
    //     const buyer = Keypair.generate();
    //     await context.setAccount(buyer.publicKey, {
    //         lamports: 20_000_000_000,
    //         owner: anchor.web3.SystemProgram.programId,
    //         executable: false,
    //         data: Buffer.alloc(0),
    //     });
    //     const buyerTicketAta = await createAta(ticketMintSol, buyer.publicKey);
    //     await assert.rejects(async () => {
    //         await buyTickets(
    //             program,
    //             rafflePdaSol,
    //             raffleIdSol,
    //             buyer,
    //             2,
    //             ticketMintSol,
    //             ticketEscrowSol,
    //             buyerTicketAta,
    //             raffle_admin
    //         );
    //     });
    // });

    // // Overflow in buyer tickets
    // it("fails on overflow in buyer tickets", async () => {
    //     const buyer = Keypair.generate();
    //     await context.setAccount(buyer.publicKey, {
    //         lamports: 20_000_000_000,
    //         owner: anchor.web3.SystemProgram.programId,
    //         executable: false,
    //         data: Buffer.alloc(0),
    //     });
    //     const buyerTicketAta = await createAta(ticketMintSol, buyer.publicKey);
    //     await buyTickets(
    //         program,
    //         rafflePdaSol,
    //         raffleIdSol,
    //         buyer,
    //         1,
    //         ticketMintSol,
    //         ticketEscrowSol,
    //         buyerTicketAta,
    //         raffle_admin
    //     );
    //     const buyerAccountPda = PublicKey.findProgramAddressSync(
    //         [Buffer.from("raffle"), new anchor.BN(raffleIdSol).toArrayLike(Buffer, "le", 4), buyer.publicKey.toBuffer()],
    //         program.programId
    //     )[0];
    //     const buyerAccount = await program.account.buyer.fetch(buyerAccountPda);
    //     buyerAccount.tickets = 65535 - 1; // u16 max -1
    //     await context.setAccount(buyerAccountPda, {
    //         data: program.coder.accounts.encode("buyer", buyerAccount),
    //         lamports: await getSolBalance(buyerAccountPda),
    //         owner: program.programId,
    //         executable: false,
    //     });
    //     await assert.rejects(async () => {
    //         await buyTickets(
    //             program,
    //             rafflePdaSol,
    //             raffleIdSol,
    //             buyer,
    //             2,
    //             ticketMintSol,
    //             ticketEscrowSol,
    //             buyerTicketAta,
    //             raffle_admin
    //         );
    //     });
    // });

    // // Check multiple buys add up
    // it("multiple buys from same buyer add up", async () => {
    //     const buyer = Keypair.generate();
    //     await context.setAccount(buyer.publicKey, {
    //         lamports: 20_000_000_000,
    //         owner: anchor.web3.SystemProgram.programId,
    //         executable: false,
    //         data: Buffer.alloc(0),
    //     });
    //     const buyerTicketAta = await createAta(ticketMintSol, buyer.publicKey);
    //     await buyTickets(
    //         program,
    //         rafflePdaSol,
    //         raffleIdSol,
    //         buyer,
    //         1,
    //         ticketMintSol,
    //         ticketEscrowSol,
    //         buyerTicketAta,
    //         raffle_admin
    //     );
    //     await buyTickets(
    //         program,
    //         rafflePdaSol,
    //         raffleIdSol,
    //         buyer,
    //         1,
    //         ticketMintSol,
    //         ticketEscrowSol,
    //         buyerTicketAta,
    //         raffle_admin
    //     );
    //     const buyerAccountPda = PublicKey.findProgramAddressSync(
    //         [Buffer.from("raffle"), new anchor.BN(raffleIdSol).toArrayLike(Buffer, "le", 4), buyer.publicKey.toBuffer()],
    //         program.programId
    //     )[0];
    //     const buyerAccount = await program.account.buyer.fetch(buyerAccountPda);
    //     assert.strictEqual(buyerAccount.tickets, 2);
    // });
});