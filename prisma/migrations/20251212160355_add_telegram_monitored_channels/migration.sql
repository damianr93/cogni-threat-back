-- CreateTable
CREATE TABLE "telegram_monitored_channels" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "channelId" TEXT,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telegram_monitored_channels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "telegram_monitored_channels_username_key" ON "telegram_monitored_channels"("username");
