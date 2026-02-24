"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const prisma_1 = __importDefault(require("../utils/prisma"));
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/google
// Aurora app kirim data dari Google Sign In SDK → backend simpan user → return JWT
//
// Body: { googleId, email, name, photoUrl? }
// Response: { token, user }
// ─────────────────────────────────────────────────────────────────────────────
const googleAuthSchema = zod_1.z.object({
    googleId: zod_1.z.string().min(1),
    email: zod_1.z.string().email(),
    name: zod_1.z.string().min(1),
    photoUrl: zod_1.z.string().url().optional().nullable(),
});
router.post("/google", async (req, res, next) => {
    try {
        const body = googleAuthSchema.parse(req.body);
        // Upsert: buat user baru atau update jika sudah ada
        // Prisma ORM — bukan raw SQL
        const user = await prisma_1.default.user.upsert({
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
        const token = (0, auth_1.generateToken)({ userId: user.id, email: user.email });
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
    }
    catch (err) {
        next(err);
    }
});
// ─────────────────────────────────────────────────────────────────────────────
// GET /api/auth/me
// Verifikasi JWT dan return data user yang sedang login
// Header: Authorization: Bearer <token>
// ─────────────────────────────────────────────────────────────────────────────
router.get("/me", auth_1.requireAuth, async (req, res, next) => {
    try {
        // Prisma ORM query
        const user = await prisma_1.default.user.findUnique({
            where: { id: req.user.userId },
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
    }
    catch (err) {
        next(err);
    }
});
// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/auth/wallet
// Connect wallet address Polygon ke akun Aurora
// Wallet address ini akan dipakai untuk fetch posisi real dari Polymarket
// ─────────────────────────────────────────────────────────────────────────────
const walletSchema = zod_1.z.object({
    walletAddress: zod_1.z
        .string()
        .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum/Polygon wallet address"),
});
router.put("/wallet", auth_1.requireAuth, async (req, res, next) => {
    try {
        const { walletAddress } = walletSchema.parse(req.body);
        // Cek apakah wallet sudah dipakai user lain
        const existing = await prisma_1.default.user.findUnique({
            where: { walletAddress: walletAddress.toLowerCase() },
        });
        if (existing && existing.id !== req.user.userId) {
            res.status(409).json({
                error: "Wallet address already connected to another account",
            });
            return;
        }
        // Update user via Prisma ORM
        const user = await prisma_1.default.user.update({
            where: { id: req.user.userId },
            data: { walletAddress: walletAddress.toLowerCase() },
            select: {
                id: true,
                email: true,
                walletAddress: true,
            },
        });
        // Catat transaksi wallet connect
        await prisma_1.default.transaction.create({
            data: {
                userId: req.user.userId,
                type: "WALLET_CONNECT",
                description: `Wallet connected: ${walletAddress}`,
                status: "COMPLETED",
                metadata: { walletAddress },
            },
        });
        res.json({ data: user, message: "Wallet connected successfully" });
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=auth.js.map