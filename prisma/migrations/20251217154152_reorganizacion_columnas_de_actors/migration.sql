/*
  Warnings:

  - You are about to drop the column `rol` on the `actors_data` table. All the data in the column will be lost.
  - You are about to drop the column `victims` on the `actors_data` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "actors_data" DROP COLUMN "rol",
DROP COLUMN "victims";
