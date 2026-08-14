-- CreateTable
CREATE TABLE "MonthLock" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedBy" TEXT NOT NULL,

    CONSTRAINT "MonthLock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthLockAudit" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "performedBy" TEXT NOT NULL,
    "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonthLockAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MonthLock_orgId_userId_idx" ON "MonthLock"("orgId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "MonthLock_orgId_userId_year_month_key" ON "MonthLock"("orgId", "userId", "year", "month");

-- CreateIndex
CREATE INDEX "MonthLockAudit_orgId_userId_year_month_idx" ON "MonthLockAudit"("orgId", "userId", "year", "month");

-- AddForeignKey
ALTER TABLE "MonthLock" ADD CONSTRAINT "MonthLock_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthLock" ADD CONSTRAINT "MonthLock_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
