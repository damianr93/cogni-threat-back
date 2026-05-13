-- CreateTable
CREATE TABLE "cyber_news_data" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "identificatedDate" TIMESTAMP(3),
    "origin" TEXT NOT NULL,
    "target" TEXT,
    "methods" TEXT,
    "consequences" TEXT[],
    "links" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cyber_news_data_pkey" PRIMARY KEY ("id")
);
