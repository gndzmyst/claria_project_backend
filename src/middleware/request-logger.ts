import { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger";

// ─────────────────────────────────────────────────────────────────────────────
// Request Logger Middleware
// Log setiap HTTP request yang masuk beserta response time-nya
// ─────────────────────────────────────────────────────────────────────────────
export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 400 ? "warn" : "debug";
    logger[level](
      `${req.method} ${req.originalUrl} → ${res.statusCode} [${duration}ms]`,
    );
  });

  next();
}
