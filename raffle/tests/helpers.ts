// tests/helpers.ts
import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
    createInitializeMintInstruction,
    createAssociatedTokenAccountIdempotentInstruction,
    createTransferCheckedInstruction,
    TOKEN_PROGRAM_ID,
    getAssociatedTokenAddressSync,
    createMintToInstruction,
    AccountLayout,
} from "@solana/spl-token";
import { PrizeType } from "../target/types/raffle";
import { getProvider, raffleConfigPda } from "./values";
import { Clock } from "solana-bankrun";

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
            provider.wallet.publicKey, // payer
            ata,
            owner,
            mint
        )
    );

    await provider.sendAndConfirm(tx);
    return ata;
}

export async function mintTokens(mint: PublicKey, to: PublicKey, amount: number) {
    const provider = getProvider();
    const tx = new Transaction().add(
        createMintToInstruction(
            mint,
            to,
            provider.wallet.publicKey, // mint authority
            amount
        )
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
    admin: Keypair,
    winners: PublicKey[],
    ticketMint: PublicKey,
    ticketEscrow: PublicKey,
    ticketFeeTreasury: PublicKey
) {
    await program.methods
        .announceWinners(raffleId, winners)
        .accounts({
            raffleConfig: raffleConfigPda(),
            raffle: rafflePda,
            raffleAdmin: admin.publicKey,
            ticketMint,
            ticketEscrow,
            ticketFeeTreasury,
            ticketTokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc();
}

export async function buyerClaimPrize(
    program: anchor.Program,
    rafflePda: PublicKey,
    raffleId: number,
    winner: anchor.web3.Keypair,
    raffleAdmin: anchor.web3.Keypair,
    prizeMint: PublicKey | null,
    prizeEscrow: PublicKey | null,
    winnerPrizeAta: PublicKey | null,
) {
    let accounts: any = {
        raffleConfig: raffleConfigPda(),
        raffle: rafflePda,
        buyerAccount: PublicKey.findProgramAddressSync(
            [
                Buffer.from("raffle"),
                new anchor.BN(raffleId).toArrayLike(Buffer, "le", 4),
                winner.publicKey.toBuffer(),
            ],
            program.programId
        )[0],
        raffleAdmin: raffleAdmin.publicKey,
        winner: winner.publicKey,
        systemProgram: SystemProgram.programId,
    };

    /**
     * If prize type is SPL/NFT, we MUST attach
     * prize_mint, prize_escrow, winner_prize_ata, token_program
     */
    if (prizeMint !== null) {
        accounts = {
            ...accounts,
            prizeMint,
            prizeEscrow,
            winnerPrizeAta,
            prizeTokenProgram: TOKEN_PROGRAM_ID,
        };
    }

    return await program.methods
        .buyerClaimPrize(raffleId)
        .accounts(accounts)
        .signers([winner, raffleAdmin])
        .rpc();
}

export async function creatorClaimAmountBack(
    program: anchor.Program,
    rafflePda: PublicKey,
    raffleId: number,
    creator: anchor.web3.Keypair,
    raffleAdmin: anchor.web3.Keypair,
    prizeMint: PublicKey | null,
    ticketMint: PublicKey | null,
    prizeEscrow: PublicKey | null,
    ticketEscrow: PublicKey | null,
    creatorPrizeAta: PublicKey | null,
    creatorTicketAta: PublicKey | null,
) {
    let accounts: any = {
        raffleConfig: raffleConfigPda(),
        raffle: rafflePda,
        creator: creator.publicKey,
        raffleAdmin: raffleAdmin.publicKey,
        systemProgram: SystemProgram.programId,
    };

    /**
     * SPL prize & ticket details added when non-null
     */
    if (prizeMint !== null) {
        accounts = {
            ...accounts,
            prizeMint,
            prizeEscrow,
            creatorPrizeAta,
            prizeTokenProgram: TOKEN_PROGRAM_ID,
        };
    }

    if (ticketMint !== null) {
        accounts = {
            ...accounts,
            ticketMint,
            ticketEscrow,
            creatorTicketAta,
            ticketTokenProgram: TOKEN_PROGRAM_ID,
        };
    }

    return await program.methods
        .claimAmountBack(raffleId)
        .accounts(accounts)
        .signers([creator, raffleAdmin])
        .rpc();
}

export function buyerPda(
    raffleId: number,
    user: PublicKey,
    programId: PublicKey,
): PublicKey {
    return PublicKey.findProgramAddressSync(
        [
            Buffer.from("raffle"),
            new anchor.BN(raffleId).toArrayLike(Buffer, "le", 4),
            user.toBuffer(),
        ],
        programId
    )[0];
}

// === UTILS ===

export async function getSolBalance(pubkey: PublicKey): Promise<number> {
    return getProvider().context.banksClient.getBalance(pubkey)
}

export async function getTokenBalance(ata: PublicKey): Promise<number> {
    const provider = getProvider();
    const client = provider.context.banksClient;

    const account = await client.getAccount(ata);
    if (!account) return 0;

    // SPL Token account layout decode
    const data = AccountLayout.decode(account.data as Buffer);
    return Number(data.amount);
}

export async function getCurrentTimestamp(): Promise<number> {
    const client = getProvider().context.banksClient;
    const nowClock = await client.getClock();
    return Number(nowClock.unixTimestamp);
}


export async function warpForward(seconds: number) {
    const context = getProvider().context;
    const client = context.banksClient;
    const nowClock = await client.getClock();
    const newTime = Number(nowClock.unixTimestamp) + 400;
    console.log("newTime => ", newTime)

    context.setClock(
        new Clock(
            nowClock.slot,
            nowClock.epochStartTimestamp,
            nowClock.epoch,
            nowClock.leaderScheduleEpoch,
            BigInt(newTime),
        ),
    );
}