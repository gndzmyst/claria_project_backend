-- AlterTable
ALTER TABLE "markets" ADD COLUMN     "featured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isNew" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "markets_featured_volume24h_idx" ON "markets"("featured", "volume24h");

-- CreateIndex
CREATE INDEX "markets_isNew_idx" ON "markets"("isNew");
