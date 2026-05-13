/*
  Warnings:

  - Added the required column `title` to the `fake_news_data` table without a default value. This is not possible if the table is not empty.

*/
-- Paso 1: Agregar las columnas como nullable primero
ALTER TABLE "fake_news_data" 
ADD COLUMN "identificatedDate" TIMESTAMP(3),
ADD COLUMN "title" TEXT;

-- Paso 2: Actualizar los registros existentes usando origin como title
-- Si el origin es muy largo (>100 caracteres), lo truncamos
UPDATE "fake_news_data" 
SET "title" = CASE 
  WHEN LENGTH("origin") > 100 THEN LEFT("origin", 100) || '...'
  ELSE "origin"
END
WHERE "title" IS NULL;

-- Paso 3: Hacer title NOT NULL ahora que todos los registros tienen valor
ALTER TABLE "fake_news_data" 
ALTER COLUMN "title" SET NOT NULL;
