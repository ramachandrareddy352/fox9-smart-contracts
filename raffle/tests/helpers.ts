// tests/helpers.ts
import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
    createInitializeMintInstruction,
    createAssociatedTokenAccountIdempotentInstruction,
    createMintToCheckedInstruction,
    createTransferCheckedInstruction,
    TOKEN_PROGRAM_ID,
    getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { PrizeType } from "../target/types/raffle";
import { getProgram, getProvider, raffleConfigPda } from "./values";

// === CORE HELPERS (Bankrun Compatible) ===

export async function createSplMint(decimals = 9): Promise<PublicKey> {
    const provider = getProvider();
    const mint = Keypair.generate();

    const lamports = await provider.connection.getMinimumBalanceForRentExemption(82);
    const tx = new Transaction().add(
        SystemProgram.createAccount({
            fromPubkey: provider.wallet.publicKey,
            newAccountPubkey: mint.publicKey,
            space: 82,
            lamports,
            programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMintInstruction(mint.publicKey, decimals, provider.wallet.publicKey, null)
    );

    await provider.sendAndConfirm(tx, [mint]);
    return mint.publicKey;
}

export async function createNftMint(): Promise<PublicKey> {
    return createSplMint(0);
}

export async function createAta(mint: PublicKey, owner: PublicKey): Promise<PublicKey> {
    const provider = getProvider();
    const ata = getAssociatedTokenAddressSync(mint, owner, true);

    const tx = new Transaction().add(
        createAssociatedTokenAccountIdempotentInstruction(
            provider.wallet.publicKey,
            ata,
            owner,
            mint
        )
    );

    await provider.sendAndConfirm(tx);
    return ata;
}

export async function mintTokens(mint: PublicKey, to: PublicKey, amount: number, decimals = 9) {
    const provider = getProvider();
    const tx = new Transaction().add(
        createMintToCheckedInstruction(mint, to, provider.wallet.publicKey, amount, decimals)
    );
    await provider.sendAndConfirm(tx);
}

export async function transferTokens(
    from: PublicKey,
    to: PublicKey,
    mint: PublicKey,
    amount: number,
    owner: Keypair,
    decimals = 9
) {
    const provider = getProvider();
    const tx = new Transaction().add(
        createTransferCheckedInstruction(from, mint, to, owner.publicKey, amount, decimals)
    );
    await provider.sendAndConfirm(tx, [owner]);
}

// === RAFFLE CONFIG ===

export async function createRaffleConfig(
    program: anchor.Program,
    owner: Keypair,
    admin: PublicKey,
    params: {
        creationFeeLamports: number;
        ticketFeeBps: number;
        minPeriod: number;
        maxPeriod: number;
    }
) {
    await program.methods
        .initializeRaffleConfig(
            owner.publicKey,
            admin,
            new anchor.BN(params.creationFeeLamports),
            params.ticketFeeBps,
            params.minPeriod,
            params.maxPeriod
        )
        .accounts({
            raffleConfig: raffleConfigPda(),
            payer: owner.publicKey,
            systemProgram: SystemProgram.programId,
        })
        .signers([owner])
        .rpc();
}

// === CREATE RAFFLE ===

export async function buildCreateRaffleAccounts(
    rafflePda: PublicKey,
    creator: Keypair,
    ticketMint: PublicKey,
    prizeMint: PublicKey
) {
    const creatorPrizeAta = await createAta(prizeMint, creator.publicKey);
    const prizeEscrow = await createAta(prizeMint, rafflePda);
    const ticketEscrow = await createAta(ticketMint, rafflePda);
    return { ticketEscrow, prizeEscrow, creatorPrizeAta };
}

export async function createRaffle(
    program: anchor.Program,
    args: {
        startTime: number;
        endTime: number;
        totalTickets: number;
        ticketPrice: number;
        isTicketSol: boolean;
        maxPct: number;
        prizeType: PrizeType;
        prizeAmount: number;
        numWinners: number;
        winShares: number[];
        unique: boolean;
        autoStart: boolean;
    },
    accounts: {
        raffleConfig: PublicKey;
        rafflePda: PublicKey;
        creator: Keypair;
        raffleAdmin: Keypair;
        ticketMint: PublicKey;
        prizeMint: PublicKey;
        ticketEscrow: PublicKey;
        prizeEscrow: PublicKey;
        creatorPrizeAta: PublicKey;
    }
) {
    const response = await program.methods
        .createRaffle(
            new anchor.BN(args.startTime),
            new anchor.BN(args.endTime),
            args.totalTickets,
            new anchor.BN(args.ticketPrice),
            args.isTicketSol,
            args.maxPct,
            args.prizeType,
            new anchor.BN(args.prizeAmount),
            args.numWinners,
            Buffer.from(args.winShares),
            args.unique,
            args.autoStart
        )
        .accounts({
            raffleConfig: accounts.raffleConfig,
            raffle: accounts.rafflePda,
            creator: accounts.creator.publicKey,
            raffleAdmin: accounts.raffleAdmin.publicKey,
            ticketMint: accounts.ticketMint,
            prizeMint: accounts.prizeMint,
            ticketEscrow: accounts.ticketEscrow,
            prizeEscrow: accounts.prizeEscrow,
            creatorPrizeAta: accounts.creatorPrizeAta,
            ticketTokenProgram: TOKEN_PROGRAM_ID,
            prizeTokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
        })
        .signers([accounts.creator, accounts.raffleAdmin])
        .rpc();

    console.log(response);
}

// === ACTIVATE RAFFLE ===

export async function activateRaffle(
    program: anchor.Program,
    rafflePda: PublicKey,
    raffleId: number,
    admin: Keypair
) {
    await program.methods
        .activateRaffle(raffleId)
        .accounts({
            raffleConfig: raffleConfigPda(),
            raffle: rafflePda,
            raffleAdmin: admin.publicKey,
        })
        .signers([admin])
        .rpc();
}

// === CANCEL RAFFLE ===

export async function cancelRaffle(
    program: anchor.Program,
    rafflePda: PublicKey,
    raffleId: number,
    creator: Keypair,
    admin: Keypair,
    prizeMint: PublicKey,
    prizeEscrow: PublicKey,
    creatorPrizeAta: PublicKey,
) {
    await program.methods
        .cancelRaffle(raffleId)
        .accounts({
            raffleConfig: raffleConfigPda(),
            raffle: rafflePda,
            creator: creator.publicKey,
            raffleAdmin: admin.publicKey,
            prizeMint,
            prizeEscrow,
            creatorPrizeAta,
            prizeTokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
        })
        .signers([creator, admin])
        .rpc();
}


// === BUY TICKETS ===

export async function buyTickets(
    program: anchor.Program,
    rafflePda: PublicKey,
    raffleId: number,
    buyer: Keypair,
    ticketsToBuy: number,
    ticketMint: PublicKey,
    ticketEscrow: PublicKey,
    buyerTicketAta: PublicKey,
    raffleAdmin: Keypair
) {
    const buyerAccount = PublicKey.findProgramAddressSync(
        [
            Buffer.from("raffle"),
            new anchor.BN(raffleId).toArrayLike(Buffer, "le", 4),
            buyer.publicKey.toBuffer(),
        ],
        program.programId
    )[0];

    await program.methods
        .buyTicket(raffleId, ticketsToBuy)
        .accounts({
            raffleConfig: raffleConfigPda(),
            raffle: rafflePda,
            buyerAccount,
            buyer: buyer.publicKey,
            raffleAdmin: raffleAdmin.publicKey,
            ticketMint,
            buyerTicketAta,
            ticketEscrow,
            ticketTokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
        })
        .signers([buyer, raffleAdmin])
        .rpc();
}

// === UPDATE RAFFLE ===

export async function updateRaffleTicketing(
    program: anchor.Program,
    rafflePda: PublicKey,
    raffleId: number,
    newTotalTickets: number,
    newTicketPrice: number,
    newMaxPct: number,
    creator: Keypair,
    admin: Keypair
) {
    await program.methods
        .updateRaffleTicketing(raffleId, newTotalTickets, new anchor.BN(newTicketPrice), newMaxPct)
        .accounts({
            raffleConfig: raffleConfigPda(),
            raffle: rafflePda,
            creator: creator.publicKey,
            raffleAdmin: admin.publicKey,
        })
        .signers([creator, admin])
        .rpc();
}

export async function updateRaffleTime(
    program: anchor.Program,
    rafflePda: PublicKey,
    raffleId: number,
    newStartTime: number,
    newEndTime: number,
    creator: Keypair,
    admin: Keypair
) {
    await program.methods
        .updateRaffleTime(raffleId, new anchor.BN(newStartTime), new anchor.BN(newEndTime))
        .accounts({
            raffleConfig: raffleConfigPda(),
            raffle: rafflePda,
            creator: creator.publicKey,
            raffleAdmin: admin.publicKey,
        })
        .signers([creator, admin])
        .rpc();
}

export async function updateRaffleWinners(
    program: anchor.Program,
    rafflePda: PublicKey,
    raffleId: number,
    newWinShares: number[],
    newUnique: boolean,
    creator: Keypair,
    admin: Keypair
) {
    await program.methods
        .updateRaffleWinners(raffleId, Buffer.from(newWinShares), newUnique)
        .accounts({
            raffleConfig: raffleConfigPda(),
            raffle: rafflePda,
            creator: creator.publicKey,
            raffleAdmin: admin.publicKey,
        })
        .signers([creator, admin])
        .rpc();
}

// === ANNOUNCE WINNERS & CLAIM ===

export async function announceWinners(
    program: anchor.Program,
    rafflePda: PublicKey,
    raffleId: number,
    admin: Keypair
) {
    await program.methods
        .announceWinners(raffleId)
        .accounts({
            raffleConfig: raffleConfigPda(),
            raffle: rafflePda,
            raffleAdmin: admin.publicKey,
        })
        .signers([admin])
        .rpc();
}

export async function claimPrize(
    program: anchor.Program,
    rafflePda: PublicKey,
    raffleId: number,
    winner: Keypair,
    prizeEscrow: PublicKey,
    winnerPrizeAta: PublicKey,
    prizeMint: PublicKey
) {
    const buyerAccount = PublicKey.findProgramAddressSync(
        [
            Buffer.from("raffle"),
            new anchor.BN(raffleId).toArrayLike(Buffer, "le", 4),
            winner.publicKey.toBuffer(),
        ],
        program.programId
    )[0];

    await program.methods
        .buyerClaimPrize(raffleId)
        .accounts({
            raffleConfig: raffleConfigPda(),
            raffle: rafflePda,
            buyerAccount,
            winner: winner.publicKey,
            prizeEscrow,
            winnerPrizeAta,
            prizeMint,
            prizeTokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([winner])
        .rpc();
}

// === UTILS ===

export async function getSolBalance(pubkey: PublicKey): Promise<number> {
    return getProvider().connection.getBalance(pubkey);
}

export async function getTokenBalance(ata: PublicKey): Promise<number> {
    const info = await getProvider().connection.getTokenAccountBalance(ata);
    return Number(info.value.amount);
}

export function getCurrentTimestamp(): number {
    return getProvider().context.clock.unixTimestamp.toNumber();
}

export function warpToTimestamp(seconds: number) {
    const context = getProvider().context;
    context.setClock({
        unixTimestamp: seconds,
        slot: context.clock.slot + 100,
    });
}

export function warpForward(seconds: number) {
    const current = getCurrentTimestamp();
    warpToTimestamp(current + seconds);
}