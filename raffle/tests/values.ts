// tests/values.ts
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import type { Raffle } from "../target/types/raffle";

let program: Program<Raffle>;
let provider: any;

export function setProgram(p: Program<Raffle>) {
    program = p;
}

export function setProvider(p: any) {
    provider = p;
}

export const raffle_owner = anchor.web3.Keypair.generate();
export const raffle_admin = anchor.web3.Keypair.generate();
export const raffle_1_creator = anchor.web3.Keypair.generate();
export const raffle_2_creator = anchor.web3.Keypair.generate();
export const raffle_3_creator = anchor.web3.Keypair.generate();

export const creation_fee_lamports = 100_000_000;
export const ticket_fee_bps = 100;
export const minimum_raffle_period = 60 * 60;
export const maximum_raffle_period = 24 * 60 * 60;

export function getProgram() {
    if (!program) throw new Error("Program not set");
    return program;
}

export function getProvider() {
    if (!provider) throw new Error("Provider not set");
    return provider;
}

export function raffleConfigPda() {
    return anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("raffle")],
        getProgram().programId
    )[0];
}

export function rafflePda(raffleId: number) {
    return anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("raffle"), new anchor.BN(raffleId).toArrayLike(Buffer, "le", 4)],
        getProgram().programId
    )[0];
}