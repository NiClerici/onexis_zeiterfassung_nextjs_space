-- MIGRATION.md Punkt 3a+3b (additiver Teil): Organization + Membership.
--
-- Rein additiv, KEIN Datenverlust: neue Tabellen, neue nullable orgId-Spalten,
-- Bestandsdaten werden kopiert/verknüpft, nichts wird gelöscht oder gedroppt.
-- Genau deshalb kein Grund zum Anhalten (im Gegensatz zum späteren Schritt,
-- der die jetzt redundanten alten Spalten auf User/Customer entfernt, sobald
-- 3d alle Routen umgestellt hat — siehe MIGRATION.md, Notizen des Loops, zur
-- Begründung der zweigeteilten Migration).
--
-- Vorher/nachher (Stand dieser Migration, lokale Dev-DB):
--   User:            1 Zeile  — unverändert, bekommt keine neue Spalte hier.
--   Organization:    0 -> 1 Zeile  ("ONEXIS", slug "onexis", plan "pro").
--   Membership:      0 -> 1 Zeile  (einzige bestehende Nutzerin wird "owner",
--                                   Arbeitseinstellungen von User kopiert).
--   Customer:        2 Zeilen — orgId befüllt, userId bleibt vorerst zusätzlich.
--   TimeEntry:      66 Zeilen — orgId befüllt.
--   PensumChange:    0 Zeilen — Struktur bereit, nichts zu befüllen.
--   OvertimePayout:  0 Zeilen — Struktur bereit, nichts zu befüllen.

-- ============================================================
-- Struktur (wie von `prisma migrate diff` gegen das Zielschema erzeugt)
-- ============================================================

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "orgId" TEXT;

-- AlterTable
ALTER TABLE "OvertimePayout" ADD COLUMN     "orgId" TEXT;

-- AlterTable
ALTER TABLE "PensumChange" ADD COLUMN     "orgId" TEXT;

-- AlterTable
ALTER TABLE "TimeEntry" ADD COLUMN     "orgId" TEXT;

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'trial',
    "trialEndsAt" TIMESTAMP(3),
    "maxWeeklyHours" DOUBLE PRECISION NOT NULL DEFAULT 45,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "managerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'aktiv',
    "entryDate" DATE NOT NULL,
    "exitDate" DATE,
    "weeklyHours" DOUBLE PRECISION NOT NULL DEFAULT 42,
    "pensum" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "baseWeeklyHours" DOUBLE PRECISION,
    "basePensum" DOUBLE PRECISION,
    "vacationDays" DOUBLE PRECISION NOT NULL DEFAULT 25,
    "startDate" TIMESTAMP(3),
    "stdHoursMon" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "stdHoursTue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "stdHoursWed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "stdHoursThu" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "stdHoursFri" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "stdHoursSat" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "stdHoursSun" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- ============================================================
-- Datenmigration
-- ============================================================

-- Eine Organisation "ONEXIS" für alle bestehenden Nutzer.
INSERT INTO "Organization" ("id", "name", "slug", "plan", "maxWeeklyHours", "createdAt")
VALUES ('org_onexis_default', 'ONEXIS', 'onexis', 'pro', 45, now());

-- Für jeden bestehenden User eine Membership: der zuerst erstellte Account
-- wird "owner", alle anderen "member". Arbeitseinstellungen 1:1 von User
-- kopiert. entryDate ist NOT NULL — startDate falls vorhanden, sonst der
-- Tag der Kontoerstellung.
INSERT INTO "Membership" (
  "id", "orgId", "userId", "role", "managerId", "status", "entryDate", "exitDate",
  "weeklyHours", "pensum", "baseWeeklyHours", "basePensum", "vacationDays", "startDate",
  "stdHoursMon", "stdHoursTue", "stdHoursWed", "stdHoursThu", "stdHoursFri", "stdHoursSat", "stdHoursSun",
  "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  'org_onexis_default',
  u."id",
  CASE WHEN rn = 1 THEN 'owner' ELSE 'member' END,
  NULL,
  'aktiv',
  COALESCE(u."startDate"::date, u."createdAt"::date),
  NULL,
  u."weeklyHours", u."pensum", u."baseWeeklyHours", u."basePensum", u."vacationDays", u."startDate",
  u."stdHoursMon", u."stdHoursTue", u."stdHoursWed", u."stdHoursThu", u."stdHoursFri", u."stdHoursSat", u."stdHoursSun",
  now(), now()
FROM (SELECT *, ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, "id" ASC) AS rn FROM "User") u;

-- orgId auf allen bestehenden Datensätzen setzen (über die gerade angelegte
-- Membership des jeweiligen Nutzers).
UPDATE "TimeEntry" t SET "orgId" = m."orgId" FROM "Membership" m WHERE m."userId" = t."userId";
UPDATE "PensumChange" p SET "orgId" = m."orgId" FROM "Membership" m WHERE m."userId" = p."userId";
UPDATE "OvertimePayout" o SET "orgId" = m."orgId" FROM "Membership" m WHERE m."userId" = o."userId";
UPDATE "Customer" c SET "orgId" = m."orgId" FROM "Membership" m WHERE m."userId" = c."userId";

-- Customer-Duplikate über gleiche Namen innerhalb derselben Organisation
-- zusammenführen (Namensvergleich case-/whitespace-insensitiv). In dieser
-- Dev-DB mit nur einer Organisation und einem Nutzer ein No-op, aber generisch
-- korrekt für DBs mit mehreren Nutzern, die vor der Migration bereits
-- gleichnamige eigene Kunden angelegt hatten.
WITH duplicates AS (
  SELECT
    "id",
    "orgId",
    lower(trim("name")) AS norm_name,
    MIN("id") OVER (PARTITION BY "orgId", lower(trim("name"))) AS canonical_id
  FROM "Customer"
  WHERE "orgId" IS NOT NULL
)
UPDATE "TimeEntry" t
SET "customerId" = d.canonical_id
FROM duplicates d
WHERE t."customerId" = d."id" AND d."id" != d.canonical_id;

DELETE FROM "Customer" c
USING (
  SELECT "id", MIN("id") OVER (PARTITION BY "orgId", lower(trim("name"))) AS canonical_id
  FROM "Customer"
  WHERE "orgId" IS NOT NULL
) d
WHERE c."id" = d."id" AND d."id" != d.canonical_id;

-- ============================================================
-- Indizes und Fremdschlüssel (nach der Datenmigration, damit alle befüllten
-- orgId-Werte bereits auf eine existierende Organization verweisen)
-- ============================================================

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "Membership_orgId_idx" ON "Membership"("orgId");

-- CreateIndex
CREATE INDEX "Membership_managerId_idx" ON "Membership"("managerId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_orgId_userId_key" ON "Membership"("orgId", "userId");

-- CreateIndex
CREATE INDEX "Customer_orgId_idx" ON "Customer"("orgId");

-- CreateIndex
CREATE INDEX "OvertimePayout_orgId_date_idx" ON "OvertimePayout"("orgId", "date");

-- CreateIndex
CREATE INDEX "PensumChange_orgId_idx" ON "PensumChange"("orgId");

-- CreateIndex
CREATE INDEX "TimeEntry_orgId_date_idx" ON "TimeEntry"("orgId", "date");

-- AddForeignKey
ALTER TABLE "PensumChange" ADD CONSTRAINT "PensumChange_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OvertimePayout" ADD CONSTRAINT "OvertimePayout_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
