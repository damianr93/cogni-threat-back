-- AlterTable
ALTER TABLE "hitos_data" ADD COLUMN     "links" TEXT[] DEFAULT ARRAY[]::TEXT[],
ALTER COLUMN "link" DROP NOT NULL;
