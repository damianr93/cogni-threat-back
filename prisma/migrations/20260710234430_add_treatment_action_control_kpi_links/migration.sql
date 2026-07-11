-- AlterTable
ALTER TABLE "treatment_actions" ADD COLUMN     "controlId" TEXT,
ADD COLUMN     "kpiId" TEXT;

-- CreateIndex
CREATE INDEX "treatment_actions_controlId_idx" ON "treatment_actions"("controlId");

-- CreateIndex
CREATE INDEX "treatment_actions_kpiId_idx" ON "treatment_actions"("kpiId");

-- AddForeignKey
ALTER TABLE "treatment_actions" ADD CONSTRAINT "treatment_actions_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "operational_controls"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treatment_actions" ADD CONSTRAINT "treatment_actions_kpiId_fkey" FOREIGN KEY ("kpiId") REFERENCES "kpis"("id") ON DELETE SET NULL ON UPDATE CASCADE;
