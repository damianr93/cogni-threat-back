-- CreateTable
CREATE TABLE "data_sources" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "endpoint" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSync" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "threat_data" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "severity" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "tags" TEXT[],
    "rawData" JSONB,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "threat_data_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dashboard_configs" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dashboard_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ransomware_live_8k_data" (
    "id" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "stocktickers" TEXT NOT NULL,
    "form" TEXT NOT NULL,
    "file_date" TIMESTAMP(3) NOT NULL,
    "cik" TEXT NOT NULL,
    "adsh" TEXT NOT NULL,
    "link" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "item105" BOOLEAN NOT NULL,
    "item801" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ransomware_live_8k_data_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ransomware_csirt_country_data" (
    "id" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "team" TEXT NOT NULL,
    "team_full" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "constituency" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ransomware_csirt_country_data_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ransomware_groups_data" (
    "id" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "altname" TEXT,
    "victims" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "added_date" TIMESTAMP(3),
    "description" TEXT,
    "firstseen" TIMESTAMP(3),
    "has_negotiations" BOOLEAN NOT NULL DEFAULT false,
    "has_ransomnote" BOOLEAN NOT NULL DEFAULT false,
    "lastseen" TIMESTAMP(3),
    "negotiation_count" INTEGER NOT NULL DEFAULT 0,
    "ransomnotes_count" INTEGER NOT NULL DEFAULT 0,
    "tools" JSONB,
    "ttps" TEXT[],
    "url" TEXT,
    "vulnerabilities" TEXT[],
    "locations" JSONB,

    CONSTRAINT "ransomware_groups_data_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ransomware_list_sector_data" (
    "id" TEXT NOT NULL,
    "sector" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ransomware_list_sector_data_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ransomware_negotiation_groups_data" (
    "id" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "chats" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ransomware_negotiation_groups_data_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ransomware_negotiation_group_chat_data" (
    "id" TEXT NOT NULL,
    "ransomware_live_id" TEXT NOT NULL,
    "message_count" INTEGER NOT NULL,
    "initialwansom" TEXT NOT NULL,
    "paid" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ransomware_negotiation_group_chat_data_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ransomware_negotiation_group_chat_message_data" (
    "id" TEXT NOT NULL,
    "party" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ransomware_negotiation_group_chat_message_data_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ransomware_groups_notes_data" (
    "id" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "ransomnotes_count" TEXT NOT NULL,
    "ransomnotes" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ransomware_groups_notes_data_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ransomware_group_notes_content_data" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "notes_name" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "extension" TEXT NOT NULL,
    "ransomware_live_id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ransomware_group_notes_content_data_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ransomware_victims_data" (
    "id" TEXT NOT NULL,
    "discovered" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "website" TEXT,
    "postUrl" TEXT,
    "country" TEXT,
    "activity" TEXT,
    "duplicates" TEXT[],
    "extrainfos" TEXT[],
    "screenshot" TEXT,
    "infostealer" TEXT,
    "press" TEXT,
    "ransomwareLiveId" TEXT NOT NULL,
    "permalink" TEXT,
    "attackDate" TIMESTAMP(3),
    "victim" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ransomware_victims_data_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ransomware_yara_data" (
    "id" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "yara_count" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ransomware_yara_data_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ransomware_yara_by_group_data" (
    "id" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ransomware_yara_by_group_data_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitored_services" (
    "id" TEXT NOT NULL,
    "serviceName" TEXT NOT NULL,
    "serviceType" TEXT NOT NULL,
    "endpoint" TEXT,
    "lastCheck" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "checkInterval" INTEGER NOT NULL DEFAULT 300,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "monitored_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_sources" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "serviceName" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alert_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_notification_channels" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "label" TEXT,
    "botToken" TEXT,
    "chatIds" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_notification_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_subscriptions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "deliveryChannelId" TEXT NOT NULL,
    "settings" JSONB NOT NULL,
    "lastTriggered" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alert_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_history" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "serviceSource" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "victim" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "severity" TEXT,
    "telegramSent" BOOLEAN NOT NULL DEFAULT false,
    "telegramMessageId" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveryChannelId" TEXT,
    "deliveryStatus" TEXT,
    "errorMessage" TEXT,
    "eventId" TEXT,
    "payload" JSONB,
    "sourceKey" TEXT,
    "subscriptionId" TEXT,
    "userId" TEXT,

    CONSTRAINT "alert_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_channel_messages" (
    "id" TEXT NOT NULL,
    "channelName" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "messageId" TEXT,
    "channelId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telegram_channel_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cve_data" (
    "id" TEXT NOT NULL,
    "cveId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "publishedDate" TIMESTAMP(3) NOT NULL,
    "lastModifiedDate" TIMESTAMP(3) NOT NULL,
    "cvssV3Score" DOUBLE PRECISION,
    "cvssV3Severity" TEXT,
    "cvssV3Vector" TEXT,
    "cvssV2Score" DOUBLE PRECISION,
    "cvssV2Severity" TEXT,
    "cvssV2Vector" TEXT,
    "cvssV4Score" DOUBLE PRECISION,
    "cvssV4Severity" TEXT,
    "cweIds" TEXT[],
    "references" JSONB,
    "rawData" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cve_data_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cve_products" (
    "id" TEXT NOT NULL,
    "cveId" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "version" TEXT,
    "cpeName" TEXT NOT NULL,
    "affected" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cve_products_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "data_sources_name_key" ON "data_sources"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ransomware_groups_data_group_key" ON "ransomware_groups_data"("group");

-- CreateIndex
CREATE UNIQUE INDEX "ransomware_victims_data_ransomwareLiveId_key" ON "ransomware_victims_data"("ransomwareLiveId");

-- CreateIndex
CREATE UNIQUE INDEX "monitored_services_serviceName_key" ON "monitored_services"("serviceName");

-- CreateIndex
CREATE UNIQUE INDEX "alert_sources_key_key" ON "alert_sources"("key");

-- CreateIndex
CREATE INDEX "user_notification_channels_userId_type_idx" ON "user_notification_channels"("userId", "type");

-- CreateIndex
CREATE INDEX "alert_subscriptions_userId_idx" ON "alert_subscriptions"("userId");

-- CreateIndex
CREATE INDEX "alert_history_userId_idx" ON "alert_history"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "alert_history_incidentId_serviceSource_key" ON "alert_history"("incidentId", "serviceSource");

-- CreateIndex
CREATE UNIQUE INDEX "alert_history_subscriptionId_eventId_key" ON "alert_history"("subscriptionId", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_channel_messages_messageId_key" ON "telegram_channel_messages"("messageId");

-- CreateIndex
CREATE INDEX "telegram_channel_messages_channelName_date_idx" ON "telegram_channel_messages"("channelName", "date");

-- CreateIndex
CREATE UNIQUE INDEX "cve_data_cveId_key" ON "cve_data"("cveId");

-- CreateIndex
CREATE INDEX "cve_data_cveId_idx" ON "cve_data"("cveId");

-- CreateIndex
CREATE INDEX "cve_data_publishedDate_idx" ON "cve_data"("publishedDate");

-- CreateIndex
CREATE INDEX "cve_data_cvssV3Severity_idx" ON "cve_data"("cvssV3Severity");

-- CreateIndex
CREATE INDEX "cve_data_lastModifiedDate_idx" ON "cve_data"("lastModifiedDate");

-- CreateIndex
CREATE INDEX "cve_products_vendor_product_idx" ON "cve_products"("vendor", "product");

-- CreateIndex
CREATE UNIQUE INDEX "cve_products_cveId_cpeName_key" ON "cve_products"("cveId", "cpeName");

-- AddForeignKey
ALTER TABLE "threat_data" ADD CONSTRAINT "threat_data_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "data_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_subscriptions" ADD CONSTRAINT "alert_subscriptions_deliveryChannelId_fkey" FOREIGN KEY ("deliveryChannelId") REFERENCES "user_notification_channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_subscriptions" ADD CONSTRAINT "alert_subscriptions_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "alert_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_history" ADD CONSTRAINT "alert_history_deliveryChannelId_fkey" FOREIGN KEY ("deliveryChannelId") REFERENCES "user_notification_channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_history" ADD CONSTRAINT "alert_history_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "alert_subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cve_products" ADD CONSTRAINT "cve_products_cveId_fkey" FOREIGN KEY ("cveId") REFERENCES "cve_data"("cveId") ON DELETE CASCADE ON UPDATE CASCADE;

