-- MIGRATION.md Punkt 3, Abschluss: die durch Punkt 3d jetzt redundanten
-- Spalten entfernen. Das ist bewusst eine eigene, letzte Migration nach der
-- Routen-Umstellung (3d) statt Teil der additiven Migration aus 3a — siehe
-- MIGRATION.md, Notizen des Loops, zur Begründung der zweigeteilten
-- Migration: solange Code noch User.weeklyHours etc. gelesen hätte, wäre
-- ein Drop dieser Spalten ein Ausfall gewesen, kein Aufräumen.
--
-- Verifiziert vor dieser Migration (siehe Loop-Bericht):
--   - grep über app/api bestätigt: keine Route liest mehr user.weeklyHours,
--     user.pensum, user.vacationDays, user.startDate, user.stdHours*,
--     user.role oder customer.userId.
--   - SQL-Check bestätigt: 0 Zeilen mit orgId IS NULL in TimeEntry, Customer,
--     PensumChange, OvertimePayout — SET NOT NULL ist damit sicher.
--
-- Nichts hiervon verliert Daten: die Werte wurden in der additiven Migration
-- (3a) bereits vollständig nach Membership kopiert; hier werden nur die
-- inzwischen ungenutzten Duplikate entfernt.

-- DropForeignKey
ALTER TABLE "Customer" DROP CONSTRAINT "Customer_userId_fkey";

-- DropIndex
DROP INDEX "Customer_orgId_idx";

-- DropIndex
DROP INDEX "Customer_userId_name_key";

-- AlterTable
ALTER TABLE "Customer" DROP COLUMN "userId",
ALTER COLUMN "orgId" SET NOT NULL;

-- AlterTable
ALTER TABLE "OvertimePayout" ALTER COLUMN "orgId" SET NOT NULL;

-- AlterTable
ALTER TABLE "PensumChange" ALTER COLUMN "orgId" SET NOT NULL;

-- AlterTable
ALTER TABLE "TimeEntry" ALTER COLUMN "orgId" SET NOT NULL;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "basePensum",
DROP COLUMN "baseWeeklyHours",
DROP COLUMN "pensum",
DROP COLUMN "role",
DROP COLUMN "startDate",
DROP COLUMN "stdHoursFri",
DROP COLUMN "stdHoursMon",
DROP COLUMN "stdHoursSat",
DROP COLUMN "stdHoursSun",
DROP COLUMN "stdHoursThu",
DROP COLUMN "stdHoursTue",
DROP COLUMN "stdHoursWed",
DROP COLUMN "vacationDays",
DROP COLUMN "weeklyHours";

-- CreateIndex
CREATE UNIQUE INDEX "Customer_orgId_name_key" ON "Customer"("orgId", "name");
