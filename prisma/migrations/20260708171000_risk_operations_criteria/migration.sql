CREATE TABLE "risk_operations_config" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL DEFAULT 'default',
  "matrixSize" INTEGER NOT NULL DEFAULT 5,
  "acceptanceThreshold" INTEGER NOT NULL DEFAULT 10,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "risk_operations_config_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "risk_operations_config_key_key" ON "risk_operations_config"("key");

INSERT INTO "risk_operations_config" ("id", "key", "matrixSize", "acceptanceThreshold", "updatedAt")
VALUES ('risk_operations_default_config', 'default', 5, 10, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
