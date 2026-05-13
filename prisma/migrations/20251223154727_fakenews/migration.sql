-- CreateTable
CREATE TABLE "fake_news_data" (
    "id" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "target" TEXT,
    "methods" TEXT,
    "consequences" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fake_news_data_pkey" PRIMARY KEY ("id")
);
