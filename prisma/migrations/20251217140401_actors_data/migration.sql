-- CreateTable
CREATE TABLE "actors_data" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "identificatedDate" TIMESTAMP(3),
    "description" TEXT,
    "country" TEXT,
    "rol" TEXT,
    "descriptionMethods" TEXT,
    "methods" TEXT[],
    "aliases" TEXT[],
    "hitos" TEXT[],
    "victims" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "actors_data_pkey" PRIMARY KEY ("id")
);
