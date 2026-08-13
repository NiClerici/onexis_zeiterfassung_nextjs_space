-- MIGRATION.md Punkt 5 (additiver Teil): Projekte als Entität statt Freitext.
--
-- Rein additiv, KEIN Datenverlust: neue Tabelle Project, neue nullable/mit-
-- Default-Spalten auf Customer/TimeEntry. Die alte TimeEntry.projekt-Spalte
-- bleibt vorerst bestehen (wird erst gedroppt, sobald Code/UI nicht mehr
-- darauf schreiben — siehe MIGRATION.md, Notizen des Loops).
--
-- Vorher/nachher (Stand dieser Migration, lokale Dev-DB):
--   Customer:  2 Zeilen — unverändert, bekommt hourlyRate (NULL).
--   Project:   0 -> 1 Zeile (aus dem einzigen TimeEntry mit projekt="Test",
--              customerId gesetzt).
--   TimeEntry: 66 Zeilen — projectId auf 1 Zeile gesetzt (die migrierte),
--              billable auf allen 66 Zeilen aus dem billable-Flag des
--              verknüpften Kunden zurückgerechnet (0 Zeilen hatten vorher
--              einen customerId ausser der einen migrierten → nur diese eine
--              Zeile bekommt billable=true, alle anderen bleiben false).

-- ============================================================
-- Struktur
-- ============================================================

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "hourlyRate" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "TimeEntry" ADD COLUMN     "billable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "projectId" TEXT;

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hourlyRate" DOUBLE PRECISION,
    "budgetHours" DOUBLE PRECISION,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- ============================================================
-- Datenmigration
-- ============================================================

-- Bestehende projekt-Freitextwerte je Organisation zu Projekten zusammen-
-- fassen und verknüpfen. Ein Project braucht laut Schema zwingend eine
-- customerId — Zeilen mit projekt-Text aber OHNE customerId können deshalb
-- (generisch, für andere Datenbestände als diesen) nicht automatisch zu
-- einem Project werden; ihr Freitext geht beim späteren Drop der Spalte
-- verloren. In dieser Dev-DB betrifft das 0 Zeilen (die einzige Zeile mit
-- projekt-Text hat bereits eine customerId).
INSERT INTO "Project" ("id", "orgId", "customerId", "name", "active", "createdAt")
SELECT DISTINCT ON ("orgId", "customerId", "projekt")
  gen_random_uuid()::text,
  "orgId",
  "customerId",
  "projekt",
  true,
  now()
FROM "TimeEntry"
WHERE "projekt" IS NOT NULL AND "customerId" IS NOT NULL;

UPDATE "TimeEntry" t
SET "projectId" = p."id"
FROM "Project" p
WHERE t."projekt" = p."name"
  AND t."customerId" = p."customerId"
  AND t."orgId" = p."orgId";

-- billable aus dem bisher für kundenstunden verwendeten Kunden-Flag zurück-
-- rechnen (lib/calc.ts nutzte bislang customerId -> Customer.billable-Lookup;
-- ab jetzt trägt jeder TimeEntry sein eigenes billable-Flag direkt).
UPDATE "TimeEntry" t
SET "billable" = c."billable"
FROM "Customer" c
WHERE t."customerId" = c."id";

-- ============================================================
-- Indizes und Fremdschlüssel
-- ============================================================

-- CreateIndex
CREATE INDEX "Project_orgId_idx" ON "Project"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_orgId_customerId_name_key" ON "Project"("orgId", "customerId", "name");

-- CreateIndex
CREATE INDEX "TimeEntry_projectId_idx" ON "TimeEntry"("projectId");

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
