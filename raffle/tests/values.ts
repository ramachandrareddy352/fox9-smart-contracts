import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import * as web3 from "@solana/web3.js";
import type { Raffle } from "../target/types/raffle";

export const program = anchor.workspace.Raffle as anchor.Program<Raffle>;
export const provider = program.provider as anchor.AnchorProvider;
export const raffle_owner = new web3.Keypair();
export const raffle_admin = new web3.Keypair();
export const raffle_1_creator = new web3.Keypair();   // SPL Mint
export const raffle_2_creator = new web3.Keypair();   // SOL
export const raffle_3_creator = new web3.Keypair();   // NFT

export const creation_fee_lamports = 100_000_000;
export const ticket_fee_bps = 100;
export const minimum_raffle_period = 60 * 60;
export const maximum_raffle_period = 24 * 60 * 60;

export function raffleConfigPda() {
    return web3.PublicKey.findProgramAddressSync(
        [Buffer.from("raffle")],
        program.programId
    )[0];
}

export function rafflePda(raffleId: number) {
    return web3.PublicKey.findProgramAddressSync(
        [Buffer.from("raffle"), new BN(raffleId).toArrayLike(Buffer, "le", 4)],
        program.programId
    )[0];
}
