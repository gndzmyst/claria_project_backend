import { Router, Request, Response, NextFunction } from "express";
import { string, z } from "zod";
import prisma from "../utils/prisma";
import { requireAuth } from "../middleware/auth";
import { fetchUserPositions } from "../services/polymarket.service";

const router = Router();

// Semua route di bawah ini wajib login (JWT)
router.use(requireAuth);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/user/portfolio
// Posisi trading user + stats portfolio (total value, P&L)
// Jika user punya wallet address → fetch juga posisi real dari Polymarket
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/portfolio",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Prisma ORM — include relations
      const user = await prisma.user.findUnique({
        where: { id: req.user!.userId },
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
        return (
          sum +
          parseFloat(pos.shares.toString()) *
            parseFloat(pos.currentPrice.toString())
        );
      }, 0);

      const totalCost = user.positions.reduce((sum, pos) => {
        return (
          sum +
          parseFloat(pos.shares.toString()) *
            parseFloat(pos.avgPrice.toString())
        );
      }, 0);

      const pnl = totalValue - totalCost;
      const pnlPercent = totalCost > 0 ? (pnl / totalCost) * 100 : 0;

      // Fetch posisi real dari Polymarket jika user punya wallet
      let polymarketPositions: unknown[] = [];
      if (user.walletAddress) {
        try {
          polymarketPositions = await fetchUserPositions(user.walletAddress);
        } catch {
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
            value: (
              parseFloat(pos.shares.toString()) *
              parseFloat(pos.currentPrice.toString())
            ).toFixed(2),
            pnl: (
              (parseFloat(pos.currentPrice.toString()) -
                parseFloat(pos.avgPrice.toString())) *
              parseFloat(pos.shares.toString())
            ).toFixed(2),
            color: pos.color,
            isSimulated: pos.isSimulated,
          })),
          polymarketPositions,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/user/activity
// Histori transaksi user — deposit, withdrawal, trade
// Query: limit (default 20), type (DEPOSIT|WITHDRAWAL|TRADE|WALLET_CONNECT)
// ─────────────────────────────────────────────────────────────────────────────
const activityQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(20),
  type: z.enum(["DEPOSIT", "WITHDRAWAL", "TRADE", "WALLET_CONNECT"]).optional(),
});

router.get(
  "/activity",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { limit, type } = activityQuerySchema.parse(req.query);

      // Prisma ORM query dengan filter opsional
      const transactions = await prisma.transaction.findMany({
        where: {
          userId: req.user!.userId,
          ...(type && { type }),
        },
        orderBy: { createdAt: "desc" },
        take: limit,
      });

      res.json({ data: transactions, total: transactions.length });
    } catch (err) {
      next(err);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/user/deposit
// Simulated deposit — tambah balance demo user
// Body: { amount, method }
// ─────────────────────────────────────────────────────────────────────────────
const depositSchema = z.object({
  amount: z.number().positive().max(100000),
  method: z.enum(["card", "bank"]).default("card"),
});

router.post(
  "/deposit",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { amount, method } = depositSchema.parse(req.body);

      // Prisma $transaction — atomic: update balance + buat record transaksi
      const [updatedUser] = await prisma.$transaction([
        prisma.user.update({
          where: { id: req.user!.userId },
          data: { balance: { increment: amount } },
        }),
        prisma.transaction.create({
          data: {
            userId: req.user!.userId,
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
    } catch (err) {
      next(err);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/user/withdraw
// Simulated withdrawal — kurangi balance demo user
// Body: { amount, walletAddress? }
// ─────────────────────────────────────────────────────────────────────────────
const withdrawSchema = z.object({
  amount: z.number().positive(),
  walletAddress: z.string().optional(),
});

router.post(
  "/withdraw",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { amount, walletAddress } = withdrawSchema.parse(req.body);

      // Cek balance dulu — Prisma ORM
      const user = await prisma.user.findUnique({
        where: { id: req.user!.userId },
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
      const [updatedUser] = await prisma.$transaction([
        prisma.user.update({
          where: { id: req.user!.userId },
          data: { balance: { decrement: amount } },
        }),
        prisma.transaction.create({
          data: {
            userId: req.user!.userId,
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
    } catch (err) {
      next(err);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/user/watchlist
// Daftar market yang di-bookmark user
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/watchlist",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Prisma ORM dengan include (JOIN ke market)
      const watchlist = await prisma.watchlist.findMany({
        where: { userId: req.user!.userId },
        include: { market: true },
        orderBy: { createdAt: "desc" },
      });

      res.json({ data: watchlist.map((w) => w.market) });
    } catch (err) {
      next(err);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/user/watchlist/:marketId
// Toggle watchlist — tambah jika belum ada, hapus jika sudah ada
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "/watchlist/:marketId",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { marketId } = req.params;

      // Cek apakah market ada di DB via Prisma
      const market = await prisma.market.findUnique({
        where: { id: marketId as string },
      });
      if (!market) {
        res.status(404).json({ error: "Market not found" });
        return;
      }

      // Cek apakah sudah ada di watchlist
      const existing = await prisma.watchlist.findUnique({
        where: {
          userId_marketId: {
            userId: req.user!.userId,
            marketId: marketId as string,
          },
        },
      });

      if (existing) {
        // Hapus dari watchlist
        await prisma.watchlist.delete({ where: { id: existing.id } });
        res.json({ saved: false, message: "Removed from watchlist" });
      } else {
        // Tambah ke watchlist
        await prisma.watchlist.create({
          data: { userId: req.user!.userId, marketId: marketId as string },
        });
        res.json({ saved: true, message: "Added to watchlist" });
      }
    } catch (err) {
      next(err);
    }
  },
);

export default router;
