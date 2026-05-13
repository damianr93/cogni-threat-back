-- CreateTable
CREATE TABLE "hitos_data" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "link" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "actorsDataId" TEXT NOT NULL,

    CONSTRAINT "hitos_data_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "hitos_data" ADD CONSTRAINT "hitos_data_actorsDataId_fkey" FOREIGN KEY ("actorsDataId") REFERENCES "actors_data"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
