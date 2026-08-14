-- AlterTable
ALTER TABLE "TimeEntry" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "TimeEntryAudit" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "changedBy" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,

    CONSTRAINT "TimeEntryAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TimeEntryAudit_entryId_idx" ON "TimeEntryAudit"("entryId");

-- CreateIndex
CREATE INDEX "TimeEntryAudit_orgId_changedAt_idx" ON "TimeEntryAudit"("orgId", "changedAt");
