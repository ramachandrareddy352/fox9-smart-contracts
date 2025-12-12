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
import { getProgram, getProvider, gumballConfigPda, gumballPda, gumballPrizePda } from "./values";
import { Clock } from "solana-bankrun";
import { Gumball } from "../target/types/gumball";

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

export async function buildCreateGumballAccounts(
    gumballPda: PublicKey,
    creator: Keypair,
    ticketMint: PublicKey,
    prizeMint: PublicKey
) {
    const creatorPrizeAta = await createAta(prizeMint, creator.publicKey);
    const prizeEscrow = await createAta(prizeMint, gumballPda);
    const ticketEscrow = await createAta(ticketMint, gumballPda);
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

export async function withdrawSolFees(
    gumballOwner: Keypair,
    receiver: PublicKey,
    amount: number
) {
    await getProgram().methods
        .withdrawSolFees(new anchor.BN(amount))
        .accounts({
            gumballConfig: gumballConfigPda(),
            owner: gumballOwner.publicKey,
            receiver,
            systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([gumballOwner])
        .rpc();
}

export async function initializeGumballConfig(
    payer: Keypair,
    gumballOwner: PublicKey,
    gumballAdmin: PublicKey,
    creationFeeLamports: number,
    ticketFeeBps: number,
    minimumGumballPeriod: number,
    maximumGumballPeriod: number
) {
    await getProgram().methods
        .initializeGumballConfig(
            gumballOwner,
            gumballAdmin,
            new anchor.BN(creationFeeLamports),
            ticketFeeBps,
            minimumGumballPeriod,
            maximumGumballPeriod
        )
        .accounts({
            gumballConfig: gumballConfigPda(),
            payer: payer.publicKey,
            systemProgram: SystemProgram.programId,
        })
        .signers([payer])
        .rpc();
}

export async function createGumball(
    args: {
        startTime: number | anchor.BN;
        endTime: number | anchor.BN;
        totalTickets: number;
        ticketPrice: number | anchor.BN;
        isTicketSol: boolean;
        startGumball: boolean;
    },
    accounts: {
        gumballPda: PublicKey;
        creator: Keypair;
        gumballAdmin: Keypair;
        ticketMint: PublicKey; // InterfaceAccount passed on-chain; in tests supply mint pubkey (or dummy)
    }
) {
    await getProgram().methods
        .createGumball(
            new anchor.BN(args.startTime),
            new anchor.BN(args.endTime),
            args.totalTickets,
            new anchor.BN(args.ticketPrice),
            args.isTicketSol,
            args.startGumball
        )
        .accounts({
            gumballConfig: gumballConfigPda(),
            gumball: accounts.gumballPda,
            creator: accounts.creator.publicKey,
            gumballAdmin: accounts.gumballAdmin.publicKey,
            ticketMint: accounts.ticketMint,
            systemProgram: SystemProgram.programId,
        })
        .signers([accounts.creator, accounts.gumballAdmin])
        .rpc();
}

export async function activateGumball(
    gumballPdaAddr: PublicKey,
    gumballId: number,
    gumballAdmin: Keypair
) {
    await getProgram().methods
        .activateGumball(gumballId)
        .accounts({
            gumballConfig: gumballConfigPda(),
            gumball: gumballPdaAddr,
            gumballAdmin: gumballAdmin.publicKey,
        })
        .signers([gumballAdmin])
        .rpc();
}

export async function cancelGumball(
    gumballPdaAddr: PublicKey,
    gumballId: number,
    creator: Keypair,
    gumballAdmin: Keypair
) {
    await getProgram().methods
        .cancelGumball(gumballId)
        .accounts({
            gumballConfig: gumballConfigPda(),
            gumball: gumballPdaAddr,
            creator: creator.publicKey,
            gumballAdmin: gumballAdmin.publicKey,
        })
        .signers([creator, gumballAdmin])
        .rpc();
}

export async function endGumball(
    gumballPdaAddr: PublicKey,
    gumballId: number,
    gumballAdmin: Keypair,
    creator: Keypair,
    ticketMint: PublicKey,
    ticketEscrow: PublicKey,
    ticketFeeEscrowAta: PublicKey,
    creatorTicketAta: PublicKey
) {
    await getProgram().methods
        .endGumball(gumballId)
        .accounts({
            gumballConfig: gumballConfigPda(),
            gumball: gumballPdaAddr,
            gumballAdmin: gumballAdmin.publicKey,
            creator: creator.publicKey,
            ticketMint,
            ticketEscrow,
            ticketFeeEscrowAta,
            creatorTicketAta,
            ticketTokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
        })
        .signers([gumballAdmin])
        .rpc();
}

export async function addPrize(
    gumballPdaAddr: PublicKey,
    gumballId: number,
    prizeIndex: number,
    prizeAmount: number,
    quantity: number,
    creator: Keypair,
    gumballAdmin: Keypair,
    prizeMint: PublicKey,
    prizeEscrow: PublicKey,
    creatorPrizeAta: PublicKey
) {
    await getProgram().methods
        .addPrize(gumballId, prizeIndex, new anchor.BN(prizeAmount), quantity)
        .accounts({
            gumballConfig: gumballConfigPda(),
            gumball: gumballPdaAddr,
            prize: gumballPrizePda(gumballId, prizeIndex),
            creator: creator.publicKey,
            gumballAdmin: gumballAdmin.publicKey,
            prizeMint,
            prizeEscrow,
            creatorPrizeAta,
            prizeTokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
        })
        .signers([creator])
        .rpc();
}

export async function claimPrizeBack(
    gumballPdaAddr: PublicKey,
    gumballId: number,
    prizeIndex: number,
    creator: Keypair,
    gumballAdmin: Keypair,
    prizeMint: PublicKey,
    prizeEscrow: PublicKey,
    creatorPrizeAta: PublicKey
) {
    await getProgram().methods
        .claimPrizeBack(gumballId, prizeIndex)
        .accounts({
            gumballConfig: gumballConfigPda(),
            gumball: gumballPdaAddr,
            prize: gumballPrizePda(gumballId, prizeIndex),
            creator: creator.publicKey,
            gumballAdmin: gumballAdmin.publicKey,
            prizeMint,
            prizeEscrow,
            creatorPrizeAta,
            prizeTokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
        })
        .signers([creator])
        .rpc();
}

export async function spinGumball(
    gumballPdaAddr: PublicKey,
    gumballId: number,
    prizeIndex: number,
    spinner: Keypair,
    gumballAdmin: Keypair,
    prizeMint: PublicKey,
    prizeEscrow: PublicKey,
    spinnerPrizeAta: PublicKey,
    ticketMint: PublicKey,
    ticketEscrow: PublicKey,
    spinnerTicketAta: PublicKey
) {
    await getProgram().methods
        .spinGumball(gumballId, prizeIndex)
        .accounts({
            gumballConfig: gumballConfigPda(),
            gumball: gumballPdaAddr,
            prize: gumballPrizePda(gumballId, prizeIndex),
            spinner: spinner.publicKey,
            gumballAdmin: gumballAdmin.publicKey,
            prizeMint,
            ticketMint,
            prizeEscrow,
            spinnerPrizeAta,
            ticketEscrow,
            spinnerTicketAta,
            prizeTokenProgram: TOKEN_PROGRAM_ID,
            ticketTokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
        })
        .signers([spinner, gumballAdmin])
        .rpc();
}

export async function updateGumballTime(
    gumballPdaAddr: PublicKey,
    gumballId: number,
    newStartTime: number,
    newEndTime: number,
    startGumball: boolean,
    creator: Keypair,
    gumballAdmin: Keypair
) {
    await getProgram().methods
        .updateGumballTime(gumballId, new anchor.BN(newStartTime), new anchor.BN(newEndTime), startGumball)
        .accounts({
            gumballConfig: gumballConfigPda(),
            gumball: gumballPdaAddr,
            creator: creator.publicKey,
            gumballAdmin: gumballAdmin.publicKey,
        })
        .signers([creator, gumballAdmin])
        .rpc();
}

export async function updateGumballData(
    gumballPdaAddr: PublicKey,
    gumballId: number,
    newTicketPrice: number,
    newTotalTickets: number,
    creator: Keypair,
    gumballAdmin: Keypair
) {
    await getProgram().methods
        .updateGumballData(gumballId, new anchor.BN(newTicketPrice), newTotalTickets)
        .accounts({
            gumballConfig: gumballConfigPda(),
            gumball: gumballPdaAddr,
            creator: creator.publicKey,
            gumballAdmin: gumballAdmin.publicKey,
        })
        .signers([creator, gumballAdmin])
        .rpc();
}