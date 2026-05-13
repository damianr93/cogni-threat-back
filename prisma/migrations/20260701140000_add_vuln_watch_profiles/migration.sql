-- CreateEnum
CREATE TYPE "VulnEnvironment" AS ENUM ('APP', 'IT', 'OT', 'OTHER');

-- CreateTable
CREATE TABLE "vuln_watch_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "environment" "VulnEnvironment" NOT NULL DEFAULT 'OTHER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vuln_watch_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vuln_watch_profile_items" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "vendor" TEXT,
    "product" TEXT,
    "ecosystem" TEXT,

    CONSTRAINT "vuln_watch_profile_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vuln_watch_profiles_userId_idx" ON "vuln_watch_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "vuln_watch_profiles_userId_name_key" ON "vuln_watch_profiles"("userId", "name");

-- CreateIndex
CREATE INDEX "vuln_watch_profile_items_profileId_idx" ON "vuln_watch_profile_items"("profileId");

-- AddForeignKey
ALTER TABLE "vuln_watch_profile_items" ADD CONSTRAINT "vuln_watch_profile_items_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "vuln_watch_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
