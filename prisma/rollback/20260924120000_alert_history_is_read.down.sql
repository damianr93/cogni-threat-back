-- Development convenience only: reverts 20260924120000_alert_history_is_read.
-- This script takes no backup. Dropping the columns discards all read state.
-- Roll back the front bell (F5) and the inbox code before running it.

DROP INDEX IF EXISTS "alert_history_userId_createdAt_idx";
DROP INDEX IF EXISTS "alert_history_userId_isRead_idx";

ALTER TABLE "alert_history"
  DROP COLUMN IF EXISTS "readAt",
  DROP COLUMN IF EXISTS "isRead";

DELETE FROM "_prisma_migrations"
WHERE "migration_name" = '20260924120000_alert_history_is_read';
