import * as anchor from "@coral-xyz/anchor";
import { startAnchor } from "solana-bankrun";
import { BankrunProvider } from "anchor-bankrun";
import { SystemProgram, Keypair } from "@solana/web3.js";

import {
    auction_owner,
    auction_admin,
    setProgram,
    setProvider,
    auctionConfigPda,
    creation_fee_lamports,
    commission_bps,
    minimum_auction_period,
    maximum_auction_period,
    minimum_time_extension,
    maximum_time_extension,
} from "./values";

import {
    createAuctionConfig,
} from "./helpers";

describe("Auction Config Tests", () => {
    let context: any;
    let provider: BankrunProvider;
    let program: anchor.Program<any>;

    before(async () => {
        context = await startAnchor("", [], []);
        provider = new BankrunProvider(context);
        anchor.setProvider(provider);
        setProvider(provider);

        program = anchor.workspace.Auction as anchor.Program<any>;
        setProgram(program);

        // FUND signers
        for (const kp of [auction_owner, auction_admin]) {
            await context.setAccount(kp.publicKey, {
                lamports: 20_000_000_000,
                owner: SystemProgram.programId,
                executable: false,
                data: Buffer.alloc(0),
            });
        }
    });

    it("Initialize Auction Config (Valid)", async () => {
        await createAuctionConfig(program, auction_owner, auction_admin.publicKey, {
            creationFeeLamports: creation_fee_lamports,
            commision_bps: commission_bps,
            minPeriod: minimum_auction_period,
            maxPeriod: maximum_auction_period,
            minTimeExtension: minimum_time_extension,
            maxTimeExtension: maximum_time_extension,
        });

        const cfg = await program.account.auctionConfig.fetch(auctionConfigPda());

        console.log("=== CONFIG CREATED ===");
        console.log("Owner:", cfg.auctionOwner.toBase58());
        console.log("Admin:", cfg.auctionAdmin.toBase58());
        console.log("Creation Fee:", cfg.creationFeeLamports.toNumber());
        console.log("Commission BPS:", cfg.commissionBps);
        console.log("MinPeriod:", cfg.minimumAuctionPeriod);
        console.log("MaxPeriod:", cfg.maximumAuctionPeriod);
        console.log("MinExt:", cfg.minimumTimeExtension);
        console.log("MaxExt:", cfg.maximumTimeExtension);

        if (
            cfg.auctionOwner.toBase58() !== auction_owner.publicKey.toBase58() ||
            cfg.auctionAdmin.toBase58() !== auction_admin.publicKey.toBase58()
        ) {
            throw new Error("Config not set correctly.");
        }
    });

    // it("Should fail: Invalid auction period", async () => {
    //     const badOwner = Keypair.generate();
    //     await context.setAccount(badOwner.publicKey, {
    //         lamports: 20_000_000_000,
    //         owner: SystemProgram.programId,
    //         executable: false,
    //         data: Buffer.alloc(0),
    //     });

    //     try {
    //         await createAuctionConfig(program, badOwner, auction_admin.publicKey, {
    //             creationFeeLamports: creation_fee_lamports,
    //             commision_bps: commission_bps,
    //             minPeriod: 1000,
    //             maxPeriod: 500, // INVALID (max < min)
    //             minTimeExtension: 10,
    //             maxTimeExtension: 20,
    //         });

    //         throw new Error("Should have failed but did not.");
    //     } catch (err) {
    //         console.log("Invalid period rejected (expected):", err.error?.errorMessage);
    //     }
    // });

    // it("Should fail: Invalid time extension", async () => {
    //     const badOwner = Keypair.generate();
    //     await context.setAccount(badOwner.publicKey, {
    //         lamports: 20_000_000_000,
    //         owner: SystemProgram.programId,
    //         executable: false,
    //         data: Buffer.alloc(0),
    //     });

    //     try {
    //         await createAuctionConfig(program, badOwner, auction_admin.publicKey, {
    //             creationFeeLamports: creation_fee_lamports,
    //             commision_bps: commission_bps,
    //             minPeriod: 100,
    //             maxPeriod: 200,
    //             minTimeExtension: 100,
    //             maxTimeExtension: 50, // INVALID
    //         });

    //         throw new Error("Should have failed but did not.");
    //     } catch (err) {
    //         console.log("Invalid time extension rejected:", err.error?.errorMessage);
    //     }
    // });

    // it("Update Auction Owner", async () => {
    //     const newOwner = Keypair.generate();
    //     await context.setAccount(newOwner.publicKey, {
    //         lamports: 5_000_000_000,
    //         owner: SystemProgram.programId,
    //         executable: false,
    //         data: Buffer.alloc(0),
    //     });

    //     await program.methods
    //         .updateAuctionOwner(newOwner.publicKey)
    //         .accounts({
    //             auctionConfig: auctionConfigPda(),
    //             auctionOwner: auction_owner.publicKey,
    //         })
    //         .signers([auction_owner])
    //         .rpc();

    //     const cfg = await program.account.auctionConfig.fetch(auctionConfigPda());
    //     console.log("New Owner Set:", cfg.auctionOwner.toBase58());

    //     if (cfg.auctionOwner.toBase58() !== newOwner.publicKey.toBase58()) {
    //         throw new Error("Owner update failed");
    //     }
    // });

    // it("Should fail: Unauthorized owner update", async () => {
    //     const fake = Keypair.generate();
    //     await context.setAccount(fake.publicKey, {
    //         lamports: 5_000_000_000,
    //         owner: SystemProgram.programId,
    //         executable: false,
    //         data: Buffer.alloc(0),
    //     });

    //     try {
    //         await program.methods
    //             .updateAuctionOwner(fake.publicKey)
    //             .accounts({
    //                 auctionConfig: auctionConfigPda(),
    //                 auctionOwner: fake.publicKey, // WRONG OWNER
    //             })
    //             .signers([fake])
    //             .rpc();

    //         throw new Error("Unauthorized update should have failed.");
    //     } catch (err) {
    //         console.log("Unauthorized owner update rejected:", err.error?.errorMessage);
    //     }
    // });

    // it("Update Auction Admin", async () => {
    //     const newAdmin = Keypair.generate();
    //     await context.setAccount(newAdmin.publicKey, {
    //         lamports: 5_000_000_000,
    //         owner: SystemProgram.programId,
    //         executable: false,
    //         data: Buffer.alloc(0),
    //     });

    //     await program.methods
    //         .updateAuctionAdmin(newAdmin.publicKey)
    //         .accounts({
    //             auctionConfig: auctionConfigPda(),
    //             auctionOwner: auction_owner.publicKey,
    //         })
    //         .signers([auction_owner])
    //         .rpc();

    //     const cfg = await program.account.auctionConfig.fetch(auctionConfigPda());
    //     console.log("New Admin Set:", cfg.auctionAdmin.toBase58());

    //     if (cfg.auctionAdmin.toBase58() !== newAdmin.publicKey.toBase58()) {
    //         throw new Error("Admin update failed");
    //     }
    // });

    // it("Update Config Data (Valid)", async () => {
    //     const newFee = 50_000_000;
    //     const newComm = 250; // 2.5%

    //     await program.methods
    //         .updateConfigData(
    //             new anchor.BN(newFee),
    //             newComm,
    //             1200,
    //             3600,
    //             100,
    //             500,
    //         )
    //         .accounts({
    //             auctionConfig: auctionConfigPda(),
    //             auctionOwner: auction_owner.publicKey,
    //         })
    //         .signers([auction_owner])
    //         .rpc();

    //     const cfg = await program.account.auctionConfig.fetch(auctionConfigPda());

    //     console.log("Updated Fee:", cfg.creationFeeLamports.toNumber());
    //     console.log("Updated Commission:", cfg.commissionBps);

    //     if (cfg.commissionBps !== newComm) throw new Error("Commission update failed");
    // });

    // it("Should fail: Invalid config update values", async () => {
    //     try {
    //         await program.methods
    //             .updateConfigData(
    //                 new anchor.BN(100),
    //                 100,
    //                 500,
    //                 200, // INVALID max < min
    //                 10,
    //                 20
    //             )
    //             .accounts({
    //                 auctionConfig: auctionConfigPda(),
    //                 auctionOwner: auction_owner.publicKey,
    //             })
    //             .signers([auction_owner])
    //             .rpc();

    //         throw new Error("Invalid config update should fail");
    //     } catch (err) {
    //         console.log("Invalid config update rejected:", err.error?.errorMessage);
    //     }
    // });

    // it("Update Pause Flags", async () => {
    //     await program.methods
    //         .updatePauseAndUnpause(0b1010)
    //         .accounts({
    //             auctionConfig: auctionConfigPda(),
    //             auctionOwner: auction_owner.publicKey,
    //         })
    //         .signers([auction_owner])
    //         .rpc();

    //     const cfg = await program.account.auctionConfig.fetch(auctionConfigPda());
    //     console.log("Pause Flags:", cfg.pauseFlags);

    //     if (cfg.pauseFlags !== 0b1010) throw new Error("Pause flag update failed");
    // });

});
