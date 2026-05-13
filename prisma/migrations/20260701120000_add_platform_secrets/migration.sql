-- CreateTable
CREATE TABLE "platform_secrets" (
  "key" TEXT NOT NULL,
  "encryptedValue" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedBy" TEXT,

  CONSTRAINT "platform_secrets_pkey" PRIMARY KEY ("key")
);
