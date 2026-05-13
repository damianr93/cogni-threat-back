/*
  Warnings:

  - You are about to drop the `ai_context_vectors` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "RiskStatus" AS ENUM ('IDENTIFIED', 'ANALYZED', 'TREATMENT_DEFINED', 'TREATED', 'ACCEPTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "TreatmentOption" AS ENUM ('MITIGATE', 'ACCEPT', 'TRANSFER', 'AVOID');

-- CreateEnum
CREATE TYPE "TreatmentStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'IMPLEMENTED', 'VERIFIED');

-- CreateEnum
CREATE TYPE "TreatmentActionStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OperationalControlStatus" AS ENUM ('DRAFT', 'ACTIVE', 'MONITORING', 'NEEDS_ATTENTION', 'RETIRED');

-- CreateEnum
CREATE TYPE "KpiDirection" AS ENUM ('HIGHER_IS_BETTER', 'LOWER_IS_BETTER');

-- CreateEnum
CREATE TYPE "KpiFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "KpiMetricType" AS ENUM ('NUMBER', 'PERCENTAGE', 'RATIO', 'INDEX');

-- DropTable
DROP TABLE "ai_context_vectors";

-- CreateTable
CREATE TABLE "information_assets" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "criticality" "RiskLevel" NOT NULL DEFAULT 'MEDIUM',
    "confidentiality" INTEGER NOT NULL,
    "integrity" INTEGER NOT NULL,
    "availability" INTEGER NOT NULL,
    "ownerUserId" TEXT,
    "ownerName" TEXT,
    "businessContext" TEXT,
    "tags" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "information_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risks" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "scenario" TEXT NOT NULL,
    "threat" TEXT NOT NULL,
    "vulnerability" TEXT NOT NULL,
    "threatSource" TEXT,
    "affectedCia" TEXT[],
    "likelihood" INTEGER NOT NULL,
    "impact" INTEGER NOT NULL,
    "inherentScore" INTEGER NOT NULL,
    "inherentLevel" "RiskLevel" NOT NULL,
    "residualLikelihood" INTEGER,
    "residualImpact" INTEGER,
    "residualScore" INTEGER,
    "residualLevel" "RiskLevel",
    "status" "RiskStatus" NOT NULL DEFAULT 'IDENTIFIED',
    "ownerUserId" TEXT,
    "ownerName" TEXT,
    "context" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "risks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_treatments" (
    "id" TEXT NOT NULL,
    "riskId" TEXT NOT NULL,
    "strategy" "TreatmentOption" NOT NULL,
    "plan" TEXT NOT NULL,
    "responsibleUserId" TEXT,
    "responsibleName" TEXT,
    "dueDate" TIMESTAMP(3),
    "residualLikelihood" INTEGER,
    "residualImpact" INTEGER,
    "residualScore" INTEGER,
    "residualLevel" "RiskLevel",
    "acceptedBy" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "status" "TreatmentStatus" NOT NULL DEFAULT 'PLANNED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "risk_treatments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "treatment_actions" (
    "id" TEXT NOT NULL,
    "treatmentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "ownerUserId" TEXT,
    "ownerName" TEXT,
    "dueDate" TIMESTAMP(3),
    "status" "TreatmentActionStatus" NOT NULL DEFAULT 'PENDING',
    "evidenceUrl" TEXT,
    "evidenceNotes" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "treatment_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operational_controls" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "implementation" TEXT,
    "monitoringFrequency" TEXT,
    "ownerUserId" TEXT,
    "ownerName" TEXT,
    "parameters" JSONB,
    "status" "OperationalControlStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "operational_controls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kpis" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "metricType" "KpiMetricType" NOT NULL,
    "unit" TEXT NOT NULL,
    "frequency" "KpiFrequency" NOT NULL,
    "targetValue" DOUBLE PRECISION NOT NULL,
    "warningValue" DOUBLE PRECISION,
    "direction" "KpiDirection" NOT NULL DEFAULT 'HIGHER_IS_BETTER',
    "assetId" TEXT,
    "riskId" TEXT,
    "controlId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NO_DATA',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kpis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kpi_measurements" (
    "id" TEXT NOT NULL,
    "kpiId" TEXT NOT NULL,
    "measuredAt" TIMESTAMP(3) NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "evidenceUrl" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kpi_measurements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_ControlRisks" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ControlRisks_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_ControlTreatments" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ControlTreatments_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "information_assets_code_key" ON "information_assets"("code");

-- CreateIndex
CREATE INDEX "information_assets_isActive_idx" ON "information_assets"("isActive");

-- CreateIndex
CREATE INDEX "information_assets_criticality_idx" ON "information_assets"("criticality");

-- CreateIndex
CREATE INDEX "risks_assetId_idx" ON "risks"("assetId");

-- CreateIndex
CREATE INDEX "risks_status_idx" ON "risks"("status");

-- CreateIndex
CREATE INDEX "risks_inherentLevel_idx" ON "risks"("inherentLevel");

-- CreateIndex
CREATE INDEX "risk_treatments_riskId_idx" ON "risk_treatments"("riskId");

-- CreateIndex
CREATE INDEX "risk_treatments_status_idx" ON "risk_treatments"("status");

-- CreateIndex
CREATE INDEX "treatment_actions_treatmentId_idx" ON "treatment_actions"("treatmentId");

-- CreateIndex
CREATE INDEX "treatment_actions_status_idx" ON "treatment_actions"("status");

-- CreateIndex
CREATE INDEX "operational_controls_status_idx" ON "operational_controls"("status");

-- CreateIndex
CREATE INDEX "kpis_frequency_idx" ON "kpis"("frequency");

-- CreateIndex
CREATE INDEX "kpis_isActive_idx" ON "kpis"("isActive");

-- CreateIndex
CREATE INDEX "kpi_measurements_kpiId_measuredAt_idx" ON "kpi_measurements"("kpiId", "measuredAt");

-- CreateIndex
CREATE UNIQUE INDEX "kpi_measurements_kpiId_measuredAt_key" ON "kpi_measurements"("kpiId", "measuredAt");

-- CreateIndex
CREATE INDEX "_ControlRisks_B_index" ON "_ControlRisks"("B");

-- CreateIndex
CREATE INDEX "_ControlTreatments_B_index" ON "_ControlTreatments"("B");

-- AddForeignKey
ALTER TABLE "risks" ADD CONSTRAINT "risks_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "information_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_treatments" ADD CONSTRAINT "risk_treatments_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "risks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treatment_actions" ADD CONSTRAINT "treatment_actions_treatmentId_fkey" FOREIGN KEY ("treatmentId") REFERENCES "risk_treatments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpis" ADD CONSTRAINT "kpis_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "information_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpis" ADD CONSTRAINT "kpis_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "risks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpis" ADD CONSTRAINT "kpis_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "operational_controls"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_measurements" ADD CONSTRAINT "kpi_measurements_kpiId_fkey" FOREIGN KEY ("kpiId") REFERENCES "kpis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ControlRisks" ADD CONSTRAINT "_ControlRisks_A_fkey" FOREIGN KEY ("A") REFERENCES "operational_controls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ControlRisks" ADD CONSTRAINT "_ControlRisks_B_fkey" FOREIGN KEY ("B") REFERENCES "risks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ControlTreatments" ADD CONSTRAINT "_ControlTreatments_A_fkey" FOREIGN KEY ("A") REFERENCES "operational_controls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ControlTreatments" ADD CONSTRAINT "_ControlTreatments_B_fkey" FOREIGN KEY ("B") REFERENCES "risk_treatments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
