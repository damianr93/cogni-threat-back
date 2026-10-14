-- AlterTable
ALTER TABLE "alert_history" ADD COLUMN "isRead" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "alert_history" ADD COLUMN "readAt" TIMESTAMP(3);

-- Existing rows must not flood the inbox badge after deploy
UPDATE "alert_history" SET "isRead" = true, "readAt" = COALESCE("sentAt", "createdAt");

-- CreateIndex
CREATE INDEX "alert_history_userId_isRead_idx" ON "alert_history"("userId", "isRead");

-- CreateIndex
CREATE INDEX "alert_history_userId_createdAt_idx" ON "alert_history"("userId", "createdAt");
