import { PrismaClient } from "@prisma/client";
import { logger } from "./logger";

// Singleton pattern — satu instance PrismaClient untuk seluruh aplikasi
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
});

// Connect ke database saat aplikasi start
prisma
  .$connect()
  .then(() => {
    logger.info("✅ PostgreSQL connected via Prisma");
  })
  .catch((err: Error) => {
    logger.error("❌ Failed to connect to PostgreSQL:", {
      message: err.message,
    });
    process.exit(1);
  });

export default prisma;
