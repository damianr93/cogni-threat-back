-- CreateTable
CREATE TABLE "vuln_cves" (
    "id" TEXT NOT NULL,
    "cveId" TEXT,
    "sources" TEXT[],
    "title" TEXT,
    "description" TEXT,
    "cvssScore" DECIMAL(3,1),
    "cvssVector" TEXT,
    "cvssVersion" TEXT,
    "severity" TEXT,
    "epssScore" DECIMAL(8,5),
    "epssPercentile" DECIMAL(8,5),
    "isKev" BOOLEAN NOT NULL DEFAULT false,
    "kevDate" DATE,
    "kevDueDate" DATE,
    "kevRansomware" BOOLEAN NOT NULL DEFAULT false,
    "affectedPackages" JSONB,
    "references" JSONB,
    "publishedAt" TIMESTAMP(3),
    "modifiedAt" TIMESTAMP(3),
    "rawNvd" JSONB,
    "rawKev" JSONB,
    "rawGithub" JSONB,
    "rawOsv" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vuln_cves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vuln_sync_state" (
    "source" TEXT NOT NULL,
    "lastSyncAt" TIMESTAMP(3),
    "lastCursor" TEXT,
    "lastCount" INTEGER,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vuln_sync_state_pkey" PRIMARY KEY ("source")
);

-- CreateIndex
CREATE INDEX "vuln_cves_severity_idx" ON "vuln_cves"("severity");

-- CreateIndex
CREATE INDEX "vuln_cves_isKev_idx" ON "vuln_cves"("isKev");

-- CreateIndex
CREATE INDEX "vuln_cves_modifiedAt_idx" ON "vuln_cves"("modifiedAt" DESC);

-- CreateIndex
CREATE INDEX "vuln_cves_epssScore_idx" ON "vuln_cves"("epssScore" DESC);

-- CreateIndex
CREATE INDEX "vuln_cves_cveId_idx" ON "vuln_cves"("cveId");

-- CreateIndex
CREATE INDEX "vuln_cves_sources_idx" ON "vuln_cves" USING GIN ("sources");
