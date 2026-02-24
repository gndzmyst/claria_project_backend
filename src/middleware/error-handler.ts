import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { logger } from "../utils/logger";

// ─────────────────────────────────────────────────────────────────────────────
// Global Error Handler
// Harus dipasang paling bawah di Express (setelah semua route)
// Menangani: ZodError (validasi), error umum, dan error server
// ─────────────────────────────────────────────────────────────────────────────
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // Zod validation error — request body/query tidak valid
  if (err instanceof ZodError) {
    res.status(400).json({
      error: "Validation error",
      details: err.issues.map((e) => ({
        field: e.path.join("."),
        message: e.message,
      })),
    });
    return;
  }

  // Error dengan status code custom (misal: 404, 403)
  const error = err as {
    message?: string;
    status?: number;
    statusCode?: number;
  };
  const status = error.status || error.statusCode || 500;
  const message =
    status === 500
      ? "Internal server error"
      : error.message || "Something went wrong";

  // Log error 500 ke file
  if (status === 500) {
    logger.error(`${req.method} ${req.originalUrl} — ${message}`, { err });
  }

  res.status(status).json({ error: message });
}
