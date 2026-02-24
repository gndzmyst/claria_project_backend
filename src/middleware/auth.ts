import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

// ─── Type untuk payload JWT Aurora ──────────────────────────────────────────
export interface AuthPayload {
  userId: string;
  email: string;
}

// Extend Express Request supaya bisa akses req.user di route handler
declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// requireAuth
// Middleware untuk proteksi route — verifikasi JWT dari header Authorization
// Header format: "Authorization: Bearer <token>"
// ─────────────────────────────────────────────────────────────────────────────
export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized: No token provided" });
    return;
  }

  const token = authHeader.split(" ")[1];

  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error("JWT_SECRET is not configured");
    }

    const payload = jwt.verify(token, secret) as AuthPayload;
    req.user = payload;
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: "Unauthorized: Token has expired" });
    } else if (err instanceof jwt.JsonWebTokenError) {
      res.status(401).json({ error: "Unauthorized: Invalid token" });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// generateToken
// Buat JWT baru untuk user yang berhasil login
// ─────────────────────────────────────────────────────────────────────────────
export function generateToken(payload: AuthPayload): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not configured");
  }

  return jwt.sign(payload, secret, {
    expiresIn: (process.env.JWT_EXPIRES_IN ||
      "7d") as jwt.SignOptions["expiresIn"],
  });
}
