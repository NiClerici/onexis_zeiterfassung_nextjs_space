-- CreateTable
CREATE TABLE "CustomerMonth" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "customerId" TEXT NOT NULL,
    "projectId" TEXT,
    "hours" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerMonth_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerMonth_orgId_year_month_idx" ON "CustomerMonth"("orgId", "year", "month");

-- CreateIndex
CREATE INDEX "CustomerMonth_userId_year_month_idx" ON "CustomerMonth"("userId", "year", "month");

-- AddForeignKey
ALTER TABLE "CustomerMonth" ADD CONSTRAINT "CustomerMonth_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerMonth" ADD CONSTRAINT "CustomerMonth_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerMonth" ADD CONSTRAINT "CustomerMonth_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerMonth" ADD CONSTRAINT "CustomerMonth_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- Datenmigration
-- ============================================================

-- Bestehende Kundenstunden aus TimeEntry zu CustomerMonth aufrollen
-- (Betrieb.md-Nachtrag, 18.08.2026: Kundenstunden wandern von "pro Tag am
-- Zeiteintrag" zu "pro Monat, separat erfasst"). Nur type='arbeit', nicht
-- weich gelöscht, mit gesetztem customerId. Die Stundenberechnung folgt
-- derselben Regel wie stundenAusEintrag() in lib/calc.ts: Von/Bis minus
-- Pause (inkl. Mitternachtsüberlauf), sonst der gespeicherte hours-Wert.
-- Gruppiert nach Jahr/Monat/Kunde/Projekt — Zeilen ohne projectId rollen
-- zu einer "nur Kunde"-Zeile zusammen, Zeilen mit gesetztem projectId
-- bilden je eine eigene Zeile pro Projekt, genau wie es das neue Modell
-- vorsieht.
--
-- TimeEntry.customerId/projectId/billable werden dabei NICHT gelöscht oder
-- verändert — sie bleiben als Rückfalloption bestehen, falls diese
-- Aufrollung später gegengeprüft werden muss.
INSERT INTO "CustomerMonth" ("id", "orgId", "userId", "year", "month", "customerId", "projectId", "hours", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  "orgId",
  "userId",
  EXTRACT(YEAR FROM "date")::int AS year,
  EXTRACT(MONTH FROM "date")::int AS month,
  "customerId",
  "projectId",
  SUM(
    CASE
      WHEN "von" IS NOT NULL AND "bis" IS NOT NULL THEN
        (
          (EXTRACT(HOUR FROM "bis"::time) * 60 + EXTRACT(MINUTE FROM "bis"::time))
          - (EXTRACT(HOUR FROM "von"::time) * 60 + EXTRACT(MINUTE FROM "von"::time))
          + CASE WHEN (EXTRACT(HOUR FROM "bis"::time) * 60 + EXTRACT(MINUTE FROM "bis"::time))
                  < (EXTRACT(HOUR FROM "von"::time) * 60 + EXTRACT(MINUTE FROM "von"::time))
                 THEN 24 * 60 ELSE 0 END
          - COALESCE("pauseMin", 0)
        ) / 60.0
      ELSE COALESCE("hours", 0)
    END
  ),
  now(),
  now()
FROM "TimeEntry"
WHERE "type" = 'arbeit'
  AND "deletedAt" IS NULL
  AND "customerId" IS NOT NULL
GROUP BY "orgId", "userId", EXTRACT(YEAR FROM "date"), EXTRACT(MONTH FROM "date"), "customerId", "projectId";
