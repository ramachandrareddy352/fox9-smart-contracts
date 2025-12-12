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
    ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { getProvider, auctionConfigPda } from "./values";
import { Clock } from "solana-bankrun";
import { Auction } from "../target/types/auction";

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

export async function buildCreateAuctionAccounts(
    auctionPda: PublicKey,
    creator: Keypair,
    ticketMint: PublicKey,
    prizeMint: PublicKey
) {
    const creatorPrizeAta = await createAta(prizeMint, creator.publicKey);
    const prizeEscrow = await createAta(prizeMint, auctionPda);
    const ticketEscrow = await createAta(ticketMint, auctionPda);
    return { ticketEscrow, prizeEscrow, creatorPrizeAta };
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
    const newTime = Number(nowClock.unixTimestamp) + seconds;
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

// -------- caller functions --------
export async function createAuctionConfig(
    program: anchor.Program<Auction>,
    owner: Keypair,
    admin: PublicKey,
    params: {
        creationFeeLamports: number;
        commision_bps: number;
        minPeriod: number;
        maxPeriod: number;
        minTimeExtension: number;
        maxTimeExtension: number;
    }
) {
    await program.methods
        .initializeAuctionConfig(
            owner.publicKey,
            admin,
            new anchor.BN(params.creationFeeLamports),
            params.commision_bps,
            params.minPeriod,
            params.maxPeriod,
            params.minTimeExtension,
            params.maxTimeExtension
        )
        .accounts({
            auctionConfig: auctionConfigPda(),
            payer: owner.publicKey,
            systemProgram: SystemProgram.programId,
        })
        .signers([owner])
        .rpc();
}

export async function createAuction(
    program: anchor.Program<Auction>,
    params: {
        creator: Keypair;
        auctionAdmin: Keypair;
        prizeMint: PublicKey;
        bidMint: PublicKey | null;  // null => SOL bids
        creatorPrizeAta: PublicKey,
        prizeEscrow: PublicKey,
        startTime: number;
        endTime: number;
        startImmediately: boolean;
        baseBid: number;
        minIncrement: number;
        timeExtension: number;
    }
) {
    const cfg = await program.account.auctionConfig.fetch(
        auctionConfigPda()
    );

    const auctionId = cfg.auctionCount;
    const auctionPda = deriveAuctionPda(program, auctionId);

    await program.methods
        .createAuction(
            new anchor.BN(params.startTime),
            new anchor.BN(params.endTime),
            params.startImmediately,
            params.bidMint === null,         // is_bid_mint_sol
            new anchor.BN(params.baseBid),
            new anchor.BN(params.minIncrement),
            params.timeExtension
        )
        .accounts({
            auctionConfig: auctionConfigPda(),
            auction: auctionPda,
            creator: params.creator.publicKey,
            auctionAdmin: params.auctionAdmin.publicKey,
            prizeMint: params.prizeMint,
            bidMint: params.bidMint ?? params.prizeMint,
            creatorPrizeAta: params.creatorPrizeAta,
            prizeEscrow: params.prizeEscrow,
            prizeTokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
        })
        .signers([params.creator, params.auctionAdmin])
        .rpc();

    return { auctionId, auctionPda };
}

export async function cancelAuction(
    program: anchor.Program<Auction>,
    params: {
        auctionId: number;
        creator: Keypair;
        auctionAdmin: Keypair;
        prizeMint: PublicKey;
        prizeEscrow: PublicKey;
        creatorPrizeAta: PublicKey;
    }
) {
    const auctionPda = deriveAuctionPda(program, params.auctionId);

    // Perform RPC call
    await program.methods
        .cancelAuction(params.auctionId)
        .accounts({
            auctionConfig: auctionConfigPda(),
            auction: auctionPda,
            creator: params.creator.publicKey,
            auctionAdmin: params.auctionAdmin.publicKey,

            prizeMint: params.prizeMint,
            prizeEscrow: params.prizeEscrow,
            creatorPrizeAta: params.creatorPrizeAta,

            prizeTokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
        })
        .signers([params.creator, params.auctionAdmin]) // both signatures required
        .rpc();

    return { auctionPda };
}

export async function startAuction(
    program: anchor.Program<Auction>,
    params: {
        auctionId: number;
        auctionAdmin: Keypair;
    }
) {
    const auctionPda = deriveAuctionPda(program, params.auctionId);

    await program.methods
        .startAuction(params.auctionId)
        .accounts({
            auctionConfig: auctionConfigPda(),
            auction: auctionPda,
            auctionAdmin: params.auctionAdmin.publicKey,
        })
        .signers([params.auctionAdmin])
        .rpc();

    return { auctionPda };
}

export async function updateAuction(
    program: anchor.Program<Auction>,
    params: {
        auctionId: number;
        creator: Keypair;
        auctionAdmin: Keypair;
        startTime: number;
        endTime: number;
        startImmediately: boolean;
        baseBid: number;
        minIncrement: number;
        timeExtension: number;
    }
) {
    const auctionPda = deriveAuctionPda(program, params.auctionId);

    await program.methods
        .updateAuction(
            params.auctionId,
            new anchor.BN(params.startTime),
            new anchor.BN(params.endTime),
            params.startImmediately,
            new anchor.BN(params.baseBid),
            new anchor.BN(params.minIncrement),
            params.timeExtension
        )
        .accounts({
            auctionConfig: auctionConfigPda(),
            auction: auctionPda,
            creator: params.creator.publicKey,
            auctionAdmin: params.auctionAdmin.publicKey,
        })
        .signers([params.creator, params.auctionAdmin])
        .rpc();

    return { auctionPda };
}

export async function placeBid(
    program: anchor.Program<Auction>,
    params: {
        auctionId: number;
        bidder: Keypair;
        auctionAdmin: Keypair;
        bidAmount: number;

        // For SPL bids
        bidMint: PublicKey;
        bidderAta: PublicKey;
        prevBidder: PublicKey;
        prevBidderAta: PublicKey;
        bidEscrow: PublicKey;
    }
) {
    const auctionPda = deriveAuctionPda(program, params.auctionId);

    await program.methods
        .placeBid(params.auctionId, new anchor.BN(params.bidAmount))
        .accounts({
            auctionConfig: auctionConfigPda(),
            auction: auctionPda,
            bidder: params.bidder.publicKey,
            auctionAdmin: params.auctionAdmin.publicKey,

            prevBidderAccount: params.prevBidder,
            bidMint: params.bidMint,

            currentBidderAta: params.bidderAta,
            prevBidderAta: params.prevBidderAta,
            bidEscrow: params.bidEscrow,

            bidTokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
        })
        .signers([params.bidder, params.auctionAdmin])
        .rpc();

    return { auctionPda };
}

export async function completeAuction(
    program: anchor.Program<Auction>,
    params: {
        auctionId: number;
        auctionAdmin: Keypair;
        creator: PublicKey;
        winner: PublicKey;

        prizeMint: PublicKey;
        bidMint: PublicKey;

        prizeEscrow: PublicKey;
        bidEscrow: PublicKey;

        creatorPrizeAta: PublicKey;
        winnerPrizeAta: PublicKey;

        bidFeeTreasuryAta: PublicKey;
        creatorBidAta: PublicKey;
    }
) {
    const auctionPda = deriveAuctionPda(program, params.auctionId);

    await program.methods
        .completeAuction(params.auctionId)
        .accounts({
            auctionConfig: auctionConfigPda(),
            auction: auctionPda,
            auctionAdmin: params.auctionAdmin.publicKey,
            creator: params.creator,
            winner: params.winner,
            prizeMint: params.prizeMint,
            bidMint: params.bidMint,
            prizeEscrow: params.prizeEscrow,
            bidEscrow: params.bidEscrow,
            creatorPrizeAta: params.creatorPrizeAta,
            winnerPrizeAta: params.winnerPrizeAta,
            bidFeeTreasuryAta: params.bidFeeTreasuryAta,
            creatorBidAta: params.creatorBidAta,
            prizeTokenProgram: TOKEN_PROGRAM_ID,
            bidTokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
        })
        .signers([params.auctionAdmin])
        .rpc();

    return { auctionPda };
}

export async function deriveAuctionPda(program: anchor.Program<Auction>, auctionId: number) {
    const [pda] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("auction"),
            new anchor.BN(auctionId).toArrayLike(Buffer, "le", 4),
        ],
        program.programId
    );
    return pda;
}