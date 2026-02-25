// ─────────────────────────────────────────────────────────────────────────────
// src/routes/auth.ts
// Aurora Backend — Auth Routes
//
// Provider yang didukung:
//   1. Google Sign-In (OAuth via SDK mobile)
//   2. Phantom      (Solana wallet — signature verification)
//   3. MetaMask     (EVM wallet — signature verification)
//   4. Coinbase Wallet (EVM wallet — signature verification)
//   5. WalletConnect (EVM wallet — signature verification)
//
// Flow wallet auth:
//   1. Client minta nonce → GET /api/auth/nonce?address=0x...
//   2. Client sign nonce dengan wallet
//   3. Client kirim { address, signature, walletType } → POST /api/auth/wallet
//   4. Backend verifikasi signature → return JWT
// ─────────────────────────────────────────────────────────────────────────────

import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { ethers } from "ethers";
import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";
import prisma from "../utils/prisma";
import { generateToken, requireAuth } from "../middleware/auth";
import { logger } from "../utils/logger";

const router = Router();

// In-memory nonce store (pakai Redis jika scale horizontal)
// nonce expires 5 menit
const nonceStore = new Map<string, { nonce: string; expiresAt: number }>();

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function generateNonce(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

function cleanExpiredNonces(): void {
  const now = Date.now();
  for (const [key, val] of nonceStore.entries()) {
    if (now > val.expiresAt) nonceStore.delete(key);
  }
}

/** Verifikasi EVM signature (MetaMask, Coinbase, WalletConnect) */
function verifyEvmSignature(
  address: string,
  nonce: string,
  signature: string,
): boolean {
  try {
    const message = `Sign in to Aurora\n\nNonce: ${nonce}`;
    const recovered = ethers.verifyMessage(message, signature);
    return recovered.toLowerCase() === address.toLowerCase();
  } catch {
    return false;
  }
}

/** Verifikasi Solana signature (Phantom) */
function verifySolanaSignature(
  address: string,
  nonce: string,
  signature: string,
): boolean {
  try {
    const message = `Sign in to Aurora\n\nNonce: ${nonce}`;
    const messageBytes = new TextEncoder().encode(message);
    const signatureBytes = bs58.decode(signature);
    const publicKeyBytes = new PublicKey(address).toBytes();
    return nacl.sign.detached.verify(
      messageBytes,
      signatureBytes,
      publicKeyBytes,
    );
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/auth/nonce
// Request nonce sebelum wallet sign in
// Query: address (wallet address)
// Response: { nonce, message }
// ─────────────────────────────────────────────────────────────────────────────
router.get("/nonce", (req: Request, res: Response) => {
  const address = (req.query.address as string)?.toLowerCase();

  if (!address) {
    res.status(400).json({ error: "address query param is required" });
    return;
  }

  cleanExpiredNonces();

  const nonce = generateNonce();
  nonceStore.set(address, {
    nonce,
    expiresAt: Date.now() + 5 * 60 * 1000, // 5 menit
  });

  const message = `Sign in to Aurora\n\nNonce: ${nonce}`;
  res.json({ nonce, message });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/wallet
// Sign in dengan wallet (MetaMask, Coinbase, WalletConnect, Phantom)
//
// Body: { address, signature, walletType, name? }
// walletType: "metamask" | "coinbase" | "walletconnect" | "phantom"
// Response: { token, user }
// ─────────────────────────────────────────────────────────────────────────────
const walletAuthSchema = z.object({
  address: z.string().min(10),
  signature: z.string().min(10),
  walletType: z.enum(["metamask", "coinbase", "walletconnect", "phantom"]),
  name: z.string().min(1).max(100).optional(),
});

router.post(
  "/wallet",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { address, signature, walletType, name } = walletAuthSchema.parse(
        req.body,
      );
      const addressKey = address.toLowerCase();

      // Ambil nonce
      const stored = nonceStore.get(addressKey);
      if (!stored) {
        res
          .status(400)
          .json({ error: "Nonce not found or expired. Request a new nonce." });
        return;
      }
      if (Date.now() > stored.expiresAt) {
        nonceStore.delete(addressKey);
        res.status(400).json({ error: "Nonce expired. Request a new nonce." });
        return;
      }

      // Verifikasi signature
      let isValid = false;
      if (walletType === "phantom") {
        // Phantom bisa sign di Solana (bs58) atau EVM (0x prefix hex)
        if (signature.startsWith("0x")) {
          isValid = verifyEvmSignature(address, stored.nonce, signature);
        } else {
          isValid = verifySolanaSignature(address, stored.nonce, signature);
        }
      } else {
        // MetaMask, Coinbase, WalletConnect — semua EVM
        isValid = verifyEvmSignature(address, stored.nonce, signature);
      }

      if (!isValid) {
        res.status(401).json({ error: "Invalid signature" });
        return;
      }

      // Hapus nonce setelah terpakai (one-time use)
      nonceStore.delete(addressKey);

      // Map walletType ke AuthProvider enum
      const providerMap: Record<
        string,
        "PHANTOM" | "METAMASK" | "COINBASE" | "WALLETCONNECT"
      > = {
        phantom: "PHANTOM",
        metamask: "METAMASK",
        coinbase: "COINBASE",
        walletconnect: "WALLETCONNECT",
      };
      const authProvider = providerMap[walletType];

      // Determine field berdasarkan wallet type
      const isSolana = walletType === "phantom" && !signature.startsWith("0x");

      // Upsert user — cari berdasarkan wallet address
      let user;
      if (isSolana) {
        user = await prisma.user.upsert({
          where: { solanaAddress: address },
          create: {
            name:
              name ?? `Phantom ${address.slice(0, 6)}...${address.slice(-4)}`,
            solanaAddress: address,
            authProvider,
            balance: 1000,
          },
          update: {
            authProvider,
            updatedAt: new Date(),
          },
        });
      } else {
        const evmAddress = address.toLowerCase();
        user = await prisma.user.upsert({
          where: { walletAddress: evmAddress },
          create: {
            name:
              name ??
              `${walletType.charAt(0).toUpperCase() + walletType.slice(1)} ${evmAddress.slice(0, 6)}...${evmAddress.slice(-4)}`,
            walletAddress: evmAddress,
            authProvider,
            balance: 1000,
          },
          update: {
            authProvider,
            updatedAt: new Date(),
          },
        });
      }

      const token = generateToken({
        userId: user.id,
        email: user.email ?? user.id,
      });

      logger.info(
        `Wallet auth success: ${walletType} | ${address.slice(0, 10)}...`,
      );

      res.json({
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          photoUrl: user.photoUrl,
          balance: user.balance,
          walletAddress: user.walletAddress,
          solanaAddress: user.solanaAddress,
          authProvider: user.authProvider,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/google
// Aurora app kirim data dari Google Sign In SDK → backend simpan user → return JWT
//
// Body: { googleId, email, name, photoUrl? }
// Response: { token, user }
// ─────────────────────────────────────────────────────────────────────────────
const googleAuthSchema = z.object({
  googleId: z.string().min(1),
  email: z.string().email(),
  name: z.string().min(1),
  photoUrl: z.string().url().optional().nullable(),
});

router.post(
  "/google",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = googleAuthSchema.parse(req.body);

      const user = await prisma.user.upsert({
        where: { googleId: body.googleId },
        create: {
          googleId: body.googleId,
          email: body.email,
          name: body.name,
          photoUrl: body.photoUrl,
          authProvider: "GOOGLE",
          balance: 1000, // Demo balance $1000 USDC
        },
        update: {
          name: body.name,
          photoUrl: body.photoUrl,
          updatedAt: new Date(),
        },
      });

      const token = generateToken({
        userId: user.id,
        email: user.email ?? body.email,
      });

      res.json({
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          photoUrl: user.photoUrl,
          balance: user.balance,
          walletAddress: user.walletAddress,
          solanaAddress: user.solanaAddress,
          authProvider: user.authProvider,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/auth/me
// Verifikasi JWT dan return data user yang sedang login
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/me",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user!.userId },
        select: {
          id: true,
          email: true,
          name: true,
          photoUrl: true,
          balance: true,
          walletAddress: true,
          solanaAddress: true,
          authProvider: true,
          createdAt: true,
        },
      });

      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      res.json({ data: user });
    } catch (err) {
      next(err);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/auth/wallet/connect
// Link wallet ke akun yang sudah login (Google user tambahkan wallet)
// Body: { address, signature, walletType }
// ─────────────────────────────────────────────────────────────────────────────
const connectWalletSchema = z.object({
  address: z.string().min(10),
  signature: z.string().min(10),
  walletType: z.enum(["metamask", "coinbase", "walletconnect", "phantom"]),
});

router.put(
  "/wallet/connect",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { address, signature, walletType } = connectWalletSchema.parse(
        req.body,
      );
      const addressKey = address.toLowerCase();

      const stored = nonceStore.get(addressKey);
      if (!stored || Date.now() > stored.expiresAt) {
        nonceStore.delete(addressKey);
        res.status(400).json({ error: "Nonce not found or expired." });
        return;
      }

      const isSolana = walletType === "phantom" && !signature.startsWith("0x");
      const isValid = isSolana
        ? verifySolanaSignature(address, stored.nonce, signature)
        : verifyEvmSignature(address, stored.nonce, signature);

      if (!isValid) {
        res.status(401).json({ error: "Invalid signature" });
        return;
      }

      nonceStore.delete(addressKey);

      // Cek conflict
      if (isSolana) {
        const existing = await prisma.user.findUnique({
          where: { solanaAddress: address },
        });
        if (existing && existing.id !== req.user!.userId) {
          res.status(409).json({
            error: "Solana address already linked to another account",
          });
          return;
        }
        await prisma.user.update({
          where: { id: req.user!.userId },
          data: { solanaAddress: address },
        });
      } else {
        const evmAddress = address.toLowerCase();
        const existing = await prisma.user.findUnique({
          where: { walletAddress: evmAddress },
        });
        if (existing && existing.id !== req.user!.userId) {
          res.status(409).json({
            error: "Wallet address already linked to another account",
          });
          return;
        }
        await prisma.user.update({
          where: { id: req.user!.userId },
          data: { walletAddress: evmAddress },
        });
      }

      await prisma.transaction.create({
        data: {
          userId: req.user!.userId,
          type: "WALLET_CONNECT",
          description: `${walletType} wallet connected: ${address}`,
          status: "COMPLETED",
          metadata: { walletType, address },
        },
      });

      res.json({ message: "Wallet connected successfully" });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
