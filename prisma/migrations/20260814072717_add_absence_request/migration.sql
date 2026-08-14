-- CreateTable
CREATE TABLE "AbsenceRequest" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fromDate" DATE NOT NULL,
    "toDate" DATE NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'offen',
    "comment" TEXT,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AbsenceRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AbsenceRequest_orgId_status_idx" ON "AbsenceRequest"("orgId", "status");

-- CreateIndex
CREATE INDEX "AbsenceRequest_userId_idx" ON "AbsenceRequest"("userId");

-- AddForeignKey
ALTER TABLE "AbsenceRequest" ADD CONSTRAINT "AbsenceRequest_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AbsenceRequest" ADD CONSTRAINT "AbsenceRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
