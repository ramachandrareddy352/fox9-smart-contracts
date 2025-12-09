import * as anchor from "@coral-xyz/anchor";
import { Keypair, SystemProgram, PublicKey, Transaction, Connection } from "@solana/web3.js";
import {
    Token,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID,
    MINT_SIZE,
    getAssociatedTokenAddress,
    createMint,
    createAssociatedTokenAccount,
    mintTo,
    transfer,
    getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import { PrizeType } from "../target/types/raffle";

export async function transferSol(
    from: Keypair,
    to: PublicKey,
    lamports: number
) {
    const connection = new Connection("http://127.0.0.1:8899", "confirmed");

    const tx = new Transaction().add(
        SystemProgram.transfer({
            fromPubkey: from.publicKey,
            toPubkey: to,
            lamports,
        })
    );

    const signature = await connection.sendTransaction(tx, [from], {
        skipPreflight: false,
        preflightCommitment: "confirmed",
    });

    await connection.confirmTransaction({
        signature,
        commitment: "confirmed",
    });

    return signature;
}

export async function createSplMint(
    provider: anchor.AnchorProvider,
    decimals = 9
): Promise<PublicKey> {
    return await createMint(
        provider.connection,
        provider.wallet.payer,
        provider.wallet.publicKey,
        null,
        decimals
    );
}

export async function createNftMint(
    provider: anchor.AnchorProvider
): Promise<PublicKey> {
    // NFT = decimals = 0, supply = 1
    return await createMint(
        provider.connection,
        provider.wallet.payer,
        provider.wallet.publicKey,
        null,
        0
    );
}

export async function createAta(
    provider: anchor.AnchorProvider,
    mint: PublicKey,
    owner: PublicKey
): Promise<PublicKey> {
    const ata = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        provider.wallet.payer,  // payer funds creation
        mint,
        owner,
        true,                  // allowOwnerOffCurve? false = safer for tests
        undefined,              // commitment
        undefined,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
    );

    return ata.address; // <-- IMPORTANT FIX
}

export async function mintTokensToAta(
    provider: anchor.AnchorProvider,
    mint: PublicKey,
    ata: PublicKey,
    amount: number
) {
    await mintTo(
        provider.connection,
        provider.wallet.payer,
        mint,
        ata,
        provider.wallet.publicKey,
        amount
    );
}

export async function transferTokensToAta(
    provider: anchor.AnchorProvider,
    fromAta: PublicKey,
    toAta: PublicKey,
    owner: Keypair,
    amount: number
) {
    await transfer(
        provider.connection,
        provider.wallet.payer,
        fromAta,
        toAta,
        owner.publicKey,
        amount,
        [],
        TOKEN_PROGRAM_ID
    );
}

/**
 * Increase validator time
 * ONLY WORKS ON local test validator
 */
export async function warpTime(
    provider: anchor.AnchorProvider,
    seconds: number
) {
    await provider.connection._rpcRequest("warp", [
        (Date.now() / 1000 + seconds)
    ]);
}

/**
 * Helper to create raffle config using your instruction
 */
export async function createRaffleConfig(
    program: anchor.Program,
    configPda: PublicKey,
    owner: Keypair,
    admin: PublicKey,
    {
        creationFeeLamports,
        ticketFeeBps,
        minPeriod,
        maxPeriod,
    }: {
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
            new anchor.BN(creationFeeLamports),
            ticketFeeBps,
            minPeriod,
            maxPeriod
        )
        .accounts({
            raffleConfig: configPda,
            payer: owner.publicKey,
            systemProgram: SystemProgram.programId,
        })
        .signers([owner])
        .rpc();
}


/**
 * Build necessary PDAs & accounts for create_raffle
 */
export async function buildCreateRaffleAccounts(
    provider: anchor.AnchorProvider,
    rafflePda: PublicKey,
    creator: Keypair,
    {
        ticketMint,
        prizeMint,
    }: {
        ticketMint: PublicKey;
        prizeMint: PublicKey;
    }
) {
    const creatorPrizeAta = await createAta(provider, prizeMint, creator.publicKey);
    const prizeEscrow = await createAta(provider, prizeMint, rafflePda);
    const ticketEscrow = await createAta(provider, ticketMint, rafflePda);

    return {
        ticketEscrow,
        prizeEscrow,
        creatorPrizeAta,
    };
}

export async function getSolBalance(
    provider: anchor.AnchorProvider,
    owner: PublicKey
) {
    const lamports = await provider.connection.getBalance(owner, "confirmed");
    return lamports;                     // raw lamports
}

export async function getSplBalance(
    provider: anchor.AnchorProvider,
    ata: PublicKey
) {
    const result = await provider.connection.getTokenAccountBalance(
        ata,
        "confirmed"
    );

    return {
        raw: Number(result.value.amount),                 // integer amount
        ui: Number(result.value.uiAmount),                // decimal adjusted amount
        decimals: result.value.decimals,
    };
}

/**
 * CALL create_raffle instruction
 */
export async function createRaffle(
    program: anchor.Program,
    args: {
        startTime: number;  // Unix timestamp in seconds
        endTime: number;
        totalTickets: number;
        ticketPrice: number; // lamports
        isTicketSol: boolean;
        maxPct: number;
        prizeType: PrizeType;
        prizeAmount: number; // lamports or token amount
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
    await program.methods
        .createRaffle(
            new anchor.BN(args.startTime),    // i64
            new anchor.BN(args.endTime),      // i64
            args.totalTickets,                // u16
            new anchor.BN(args.ticketPrice),  // u64
            args.isTicketSol,                 // bool
            args.maxPct,                      // u8
            args.prizeType,                   // PrizeType enum
            new anchor.BN(args.prizeAmount),  // u64
            args.numWinners,                  // u8
            Buffer.from(args.winShares),                   // Vec<u8>
            args.unique,                      // bool
            args.autoStart                    // bool
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
}

// Helper to update raffle ticketing
export async function updateRaffleTicketing(
    program: anchor.Program,
    raffleConfig: PublicKey,
    rafflePda: PublicKey,
    raffleId: number,
    newTotalTickets: number,
    newTicketPrice: number,
    newMaxPct: number,
    creator: Keypair,
    admin: Keypair,
) {
    await program.methods
        .updateRaffleTicketing(
            raffleId,
            newTotalTickets,
            new anchor.BN(newTicketPrice),
            newMaxPct
        )
        .accounts({
            raffleConfig: raffleConfig,
            raffle: rafflePda,
            creator: creator.publicKey,
            raffleAdmin: admin.publicKey,
        })
        .signers([creator, admin])
        .rpc();
}

// Helper to update raffle time
export async function updateRaffleTime(
    program: anchor.Program,
    raffleConfig: PublicKey,
    rafflePda: PublicKey,
    raffleId: number,
    newStartTime: number,
    newEndTime: number,
    creator: Keypair,
    admin: Keypair
) {
    await program.methods
        .updateRaffleTime(
            raffleId,
            new anchor.BN(newStartTime),
            new anchor.BN(newEndTime)
        )
        .accounts({
            raffleConfig: raffleConfig,
            raffle: rafflePda,
            creator: creator.publicKey,
            raffleAdmin: admin.publicKey,
        })
        .signers([creator, admin])
        .rpc();
}

// Helper to update raffle winners
export async function updateRaffleWinners(
    program: anchor.Program,
    raffleConfig: PublicKey,
    rafflePda: PublicKey,
    raffleId: number,
    newWinShares: number[],
    newUnique: boolean,
    creator: Keypair,
    admin: Keypair
) {
    await program.methods
        .updateRaffleWinners(
            raffleId,
            Buffer.from(newWinShares),
            newUnique
        )
        .accounts({
            raffleConfig: raffleConfig,
            raffle: rafflePda,
            creator: creator.publicKey,
            raffleAdmin: admin.publicKey,
        })
        .signers([creator, admin])
        .rpc();
}

/**
 * Buy tickets in a raffle (supports both SOL and SPL tickets)
 */
export async function buyTickets(
    program: anchor.Program,
    raffleConfig: PublicKey,
    rafflePda: PublicKey,
    raffleId: number,
    buyer: Keypair,
    ticketsToBuy: number,
    ticketMint: PublicKey,
    ticketEscrow: PublicKey,
    buyerTicketAta: PublicKey,
    raffleAdmin: Keypair,
) {
    const accounts = {
        raffleConfig,
        raffle: rafflePda,
        buyerAccount: anchor.web3.PublicKey.findProgramAddressSync(
            [
                Buffer.from("raffle"),
                new anchor.BN(raffleId).toArrayLike(Buffer, "le", 4),
                buyer.publicKey.toBuffer(),
            ],
            program.programId
        )[0],
        buyer: buyer.publicKey,
        raffleAdmin: raffleAdmin.publicKey,
        ticketMint,
        buyerTicketAta,
        ticketEscrow,
        ticketTokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
    };

    await program.methods
        .buyTicket(raffleId, ticketsToBuy)
        .accounts(accounts)
        .signers([buyer, raffleAdmin]) // raffle_admin must sign
        .rpc();

}