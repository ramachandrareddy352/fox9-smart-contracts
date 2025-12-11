// tests/values.ts
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import type { Auction } from "../target/types/auction";

let program: Program<Auction>;
let provider: any;

export function setProgram(p: Program<Auction>) {
  program = p;
}

export function setProvider(p: any) {
  provider = p;
}

export const auction_owner = anchor.web3.Keypair.generate();
export const auction_admin = anchor.web3.Keypair.generate();
export const auction_1_creator = anchor.web3.Keypair.generate();
export const auction_2_creator = anchor.web3.Keypair.generate();

export const creation_fee_lamports = 100_000_000;
export const commission_bps = 100;  // 1% 
export const minimum_auction_period = 60 * 60;  // 1 hour
export const maximum_auction_period = 24 * 60 * 60;  // 24 hours
export const minimum_time_extension = 10 * 60;  // 10 minutues
export const maximum_time_extension = 60 * 60;  // 1 hour

export function getProgram() {
  if (!program) throw new Error("Program not set");
  return program;
}

export function getProvider() {
  if (!provider) throw new Error("Provider not set");
  return provider;
}

export function auctionConfigPda() {
  return anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("auction")],
    getProgram().programId
  )[0];
}

export function auctionPda(auctionId: number) {
  return anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("auction"), new anchor.BN(auctionId).toArrayLike(Buffer, "le", 4)],
    getProgram().programId
  )[0];
}