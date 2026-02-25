/*
  Warnings:

  - A unique constraint covering the columns `[solanaAddress]` on the table `users` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('GOOGLE', 'PHANTOM', 'METAMASK', 'COINBASE', 'WALLETCONNECT');

-- DropIndex
DROP INDEX "markets_isNew_idx";

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "authProvider" "AuthProvider" NOT NULL DEFAULT 'GOOGLE',
ADD COLUMN     "solanaAddress" TEXT,
ALTER COLUMN "email" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "markets_isNew_createdAt_idx" ON "markets"("isNew", "createdAt");

-- CreateIndex
CREATE INDEX "markets_endDate_active_closed_idx" ON "markets"("endDate", "active", "closed");

-- CreateIndex
CREATE INDEX "markets_volume_active_closed_idx" ON "markets"("volume", "active", "closed");

-- CreateIndex
CREATE INDEX "transactions_userId_createdAt_idx" ON "transactions"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "users_solanaAddress_key" ON "users"("solanaAddress");
