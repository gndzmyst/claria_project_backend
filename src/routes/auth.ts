import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import prisma from "../utils/prisma";
import { generateToken, requireAuth } from "../middleware/auth";

const router = Router();

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

      // Upsert: buat user baru atau update jika sudah ada
      // Prisma ORM — bukan raw SQL
      const user = await prisma.user.upsert({
        where: { googleId: body.googleId },
        create: {
          googleId: body.googleId,
          email: body.email,
          name: body.name,
          photoUrl: body.photoUrl,
          balance: 1000, // Demo balance $1000 USDC untuk user baru
        },
        update: {
          name: body.name,
          photoUrl: body.photoUrl,
          updatedAt: new Date(),
        },
      });

      const token = generateToken({ userId: user.id, email: user.email });

      res.json({
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          photoUrl: user.photoUrl,
          balance: user.balance,
          walletAddress: user.walletAddress,
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
// Header: Authorization: Bearer <token>
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/me",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Prisma ORM query
      const user = await prisma.user.findUnique({
        where: { id: req.user!.userId },
        select: {
          id: true,
          email: true,
          name: true,
          photoUrl: true,
          balance: true,
          walletAddress: true,
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
// PUT /api/auth/wallet
// Connect wallet address Polygon ke akun Aurora
// Wallet address ini akan dipakai untuk fetch posisi real dari Polymarket
// ─────────────────────────────────────────────────────────────────────────────
const walletSchema = z.object({
  walletAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum/Polygon wallet address"),
});

router.put(
  "/wallet",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { walletAddress } = walletSchema.parse(req.body);

      // Cek apakah wallet sudah dipakai user lain
      const existing = await prisma.user.findUnique({
        where: { walletAddress: walletAddress.toLowerCase() },
      });

      if (existing && existing.id !== req.user!.userId) {
        res.status(409).json({
          error: "Wallet address already connected to another account",
        });
        return;
      }

      // Update user via Prisma ORM
      const user = await prisma.user.update({
        where: { id: req.user!.userId },
        data: { walletAddress: walletAddress.toLowerCase() },
        select: {
          id: true,
          email: true,
          walletAddress: true,
        },
      });

      // Catat transaksi wallet connect
      await prisma.transaction.create({
        data: {
          userId: req.user!.userId,
          type: "WALLET_CONNECT",
          description: `Wallet connected: ${walletAddress}`,
          status: "COMPLETED",
          metadata: { walletAddress },
        },
      });

      res.json({ data: user, message: "Wallet connected successfully" });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
