// tests/values.ts
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import type { Gumball } from "../target/types/gumball";

let program: Program<Gumball>;
let provider: any;

export function setProgram(p: Program<Gumball>) {
    program = p;
}

export function setProvider(p: any) {
    provider = p;
}

export const gumball_owner = anchor.web3.Keypair.generate();
export const gumball_admin = anchor.web3.Keypair.generate();
export const gumball_1_creator = anchor.web3.Keypair.generate();
export const gumball_2_creator = anchor.web3.Keypair.generate();

export const creation_fee_lamports = 100_000_000;
export const ticket_fee_bps = 100;  // 1% 
export const minimum_Gumball_period = 60 * 60;  // 1 hour
export const maximum_Gumball_period = 24 * 60 * 60;  // 24 hours

export function getProgram() {
    if (!program) throw new Error("Program not set");
    return program;
}

export function getProvider() {
    if (!provider) throw new Error("Provider not set");
    return provider;
}

export function gumballConfigPda() {
    return anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("gumball")],
        getProgram().programId
    )[0];
}

export function gumballPda(gumballId: number) {
    return anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("gumball"), new anchor.BN(gumballId).toArrayLike(Buffer, "le", 4)],
        getProgram().programId
    )[0];
}

export function gumballPrizePda(gumballId: number, prizeIndex: number) {
    return anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("gumball"), new anchor.BN(gumballId).toArrayLike(Buffer, "le", 4), new anchor.BN(prizeIndex).toArrayLike(Buffer, "le", 2)],
        getProgram().programId
    )[0];
}