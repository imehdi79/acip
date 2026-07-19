-- CreateTable
CREATE TABLE "RateRow" (
    "id" SERIAL NOT NULL,
    "costCode" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "unitCost" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "status" TEXT NOT NULL DEFAULT 'staged',
    "sourceFile" TEXT NOT NULL,
    "sourceHint" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateRow_pkey" PRIMARY KEY ("id")
);
