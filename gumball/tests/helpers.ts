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
import { getProvider, gumballConfigPda } from "./values";
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

