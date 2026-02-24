"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const prisma_1 = __importDefault(require("../utils/prisma"));
const auth_1 = require("../middleware/auth");
const polymarket_service_1 = require("../services/polymarket.service");
const router = (0, express_1.Router)();
// Semua route di bawah ini wajib login (JWT)
router.use(auth_1.requireAuth);
// ─────────────────────────────────────────────────────────────────────────────
// GET /api/user/portfolio
// Posisi trading user + stats portfolio (total value, P&L)
// Jika user punya wallet address → fetch juga posisi real dari Polymarket
// ─────────────────────────────────────────────────────────────────────────────
router.get("/portfolio", async (req, res, next) => {
    try {
        // Prisma ORM — include relations
        const user = await prisma_1.default.user.findUnique({
            where: { id: req.user.userId },
            include: {
                positions: {
                    include: { market: true },
                    orderBy: { updatedAt: "desc" },
                },
            },
        });
        if (!user) {
            res.status(404).json({ error: "User not found" });
            return;
        }
        // Hitung total value dan P&L dari posisi Aurora (simulated)
        const totalValue = user.positions.reduce((sum, pos) => {
            return (sum +
                parseFloat(pos.shares.toString()) *
                    parseFloat(pos.currentPrice.toString()));
        }, 0);
        const totalCost = user.positions.reduce((sum, pos) => {
            return (sum +
                parseFloat(pos.shares.toString()) *
                    parseFloat(pos.avgPrice.toString()));
        }, 0);
        const pnl = totalValue - totalCost;
        const pnlPercent = totalCost > 0 ? (pnl / totalCost) * 100 : 0;
        // Fetch posisi real dari Polymarket jika user punya wallet
        let polymarketPositions = [];
        if (user.walletAddress) {
            try {
                polymarketPositions = await (0, polymarket_service_1.fetchUserPositions)(user.walletAddress);
            }
            catch {
                // Non-fatal — lanjut dengan data simulasi saja
            }
        }
        res.json({
            data: {
                balance: user.balance,
                totalValue: totalValue.toFixed(2),
                pnl: pnl.toFixed(2),
                pnlPercent: pnlPercent.toFixed(2),
                positionCount: user.positions.length,
                positions: user.positions.map((pos) => ({
                    id: pos.id,
                    market: {
                        id: pos.market.id,
                        question: pos.market.question,
                        category: pos.market.category,
                        imageUrl: pos.market.imageUrl,
                    },
                    outcome: pos.outcome,
                    shares: pos.shares,
                    avgPrice: pos.avgPrice,
                    currentPrice: pos.currentPrice,
                    value: (parseFloat(pos.shares.toString()) *
                        parseFloat(pos.currentPrice.toString())).toFixed(2),
                    pnl: ((parseFloat(pos.currentPrice.toString()) -
                        parseFloat(pos.avgPrice.toString())) *
                        parseFloat(pos.shares.toString())).toFixed(2),
                    color: pos.color,
                    isSimulated: pos.isSimulated,
                })),
                polymarketPositions,
            },
        });
    }
    catch (err) {
        next(err);
    }
});
// ─────────────────────────────────────────────────────────────────────────────
// GET /api/user/activity
// Histori transaksi user — deposit, withdrawal, trade
// Query: limit (default 20), type (DEPOSIT|WITHDRAWAL|TRADE|WALLET_CONNECT)
// ─────────────────────────────────────────────────────────────────────────────
const activityQuerySchema = zod_1.z.object({
    limit: zod_1.z.coerce.number().min(1).max(100).default(20),
    type: zod_1.z.enum(["DEPOSIT", "WITHDRAWAL", "TRADE", "WALLET_CONNECT"]).optional(),
});
router.get("/activity", async (req, res, next) => {
    try {
        const { limit, type } = activityQuerySchema.parse(req.query);
        // Prisma ORM query dengan filter opsional
        const transactions = await prisma_1.default.transaction.findMany({
            where: {
                userId: req.user.userId,
                ...(type && { type }),
            },
            orderBy: { createdAt: "desc" },
            take: limit,
        });
        res.json({ data: transactions, total: transactions.length });
    }
    catch (err) {
        next(err);
    }
});
// ─────────────────────────────────────────────────────────────────────────────
// POST /api/user/deposit
// Simulated deposit — tambah balance demo user
// Body: { amount, method }
// ─────────────────────────────────────────────────────────────────────────────
const depositSchema = zod_1.z.object({
    amount: zod_1.z.number().positive().max(100000),
    method: zod_1.z.enum(["card", "bank"]).default("card"),
});
router.post("/deposit", async (req, res, next) => {
    try {
        const { amount, method } = depositSchema.parse(req.body);
        // Prisma $transaction — atomic: update balance + buat record transaksi
        const [updatedUser] = await prisma_1.default.$transaction([
            prisma_1.default.user.update({
                where: { id: req.user.userId },
                data: { balance: { increment: amount } },
            }),
            prisma_1.default.transaction.create({
                data: {
                    userId: req.user.userId,
                    type: "DEPOSIT",
                    amount,
                    description: `Deposit via ${method.toUpperCase()}`,
                    status: "COMPLETED",
                    metadata: { method, simulated: true },
                },
            }),
        ]);
        res.json({
            message: "Deposit successful (Demo Mode)",
            newBalance: updatedUser.balance,
            amount,
        });
    }
    catch (err) {
        next(err);
    }
});
// ─────────────────────────────────────────────────────────────────────────────
// POST /api/user/withdraw
// Simulated withdrawal — kurangi balance demo user
// Body: { amount, walletAddress? }
// ─────────────────────────────────────────────────────────────────────────────
const withdrawSchema = zod_1.z.object({
    amount: zod_1.z.number().positive(),
    walletAddress: zod_1.z.string().optional(),
});
router.post("/withdraw", async (req, res, next) => {
    try {
        const { amount, walletAddress } = withdrawSchema.parse(req.body);
        // Cek balance dulu — Prisma ORM
        const user = await prisma_1.default.user.findUnique({
            where: { id: req.user.userId },
        });
        if (!user) {
            res.status(404).json({ error: "User not found" });
            return;
        }
        if (parseFloat(user.balance.toString()) < amount) {
            res.status(400).json({ error: "Insufficient balance" });
            return;
        }
        // Prisma $transaction — atomic
        const [updatedUser] = await prisma_1.default.$transaction([
            prisma_1.default.user.update({
                where: { id: req.user.userId },
                data: { balance: { decrement: amount } },
            }),
            prisma_1.default.transaction.create({
                data: {
                    userId: req.user.userId,
                    type: "WITHDRAWAL",
                    amount,
                    description: `Withdrawal to ${walletAddress || "wallet"}`,
                    status: "COMPLETED",
                    metadata: { walletAddress: walletAddress || null, simulated: true },
                },
            }),
        ]);
        res.json({
            message: "Withdrawal successful (Demo Mode)",
            newBalance: updatedUser.balance,
            amount,
        });
    }
    catch (err) {
        next(err);
    }
});
// ─────────────────────────────────────────────────────────────────────────────
// GET /api/user/watchlist
// Daftar market yang di-bookmark user
// ─────────────────────────────────────────────────────────────────────────────
router.get("/watchlist", async (req, res, next) => {
    try {
        // Prisma ORM dengan include (JOIN ke market)
        const watchlist = await prisma_1.default.watchlist.findMany({
            where: { userId: req.user.userId },
            include: { market: true },
            orderBy: { createdAt: "desc" },
        });
        res.json({ data: watchlist.map((w) => w.market) });
    }
    catch (err) {
        next(err);
    }
});
// ─────────────────────────────────────────────────────────────────────────────
// POST /api/user/watchlist/:marketId
// Toggle watchlist — tambah jika belum ada, hapus jika sudah ada
// ─────────────────────────────────────────────────────────────────────────────
router.post("/watchlist/:marketId", async (req, res, next) => {
    try {
        const { marketId } = req.params;
        // Cek apakah market ada di DB via Prisma
        const market = await prisma_1.default.market.findUnique({
            where: { id: marketId },
        });
        if (!market) {
            res.status(404).json({ error: "Market not found" });
            return;
        }
        // Cek apakah sudah ada di watchlist
        const existing = await prisma_1.default.watchlist.findUnique({
            where: {
                userId_marketId: {
                    userId: req.user.userId,
                    marketId: marketId,
                },
            },
        });
        if (existing) {
            // Hapus dari watchlist
            await prisma_1.default.watchlist.delete({ where: { id: existing.id } });
            res.json({ saved: false, message: "Removed from watchlist" });
        }
        else {
            // Tambah ke watchlist
            await prisma_1.default.watchlist.create({
                data: { userId: req.user.userId, marketId: marketId },
            });
            res.json({ saved: true, message: "Added to watchlist" });
        }
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=user.js.map