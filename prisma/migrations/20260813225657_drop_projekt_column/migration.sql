-- MIGRATION.md Punkt 5, Abschluss: die durch #5a-5d jetzt redundante
-- TimeEntry.projekt-Spalte entfernen — letzter Schritt von "Projekte als
-- Entität statt Freitext".
--
-- Verifiziert vor dieser Migration:
--   - grep über app/components/lib bestätigt: keine Code-Stelle liest oder
--     schreibt mehr TimeEntry.projekt (export/route.ts nutzt jetzt die
--     customer/project-Relation, mit leerem String statt Freitext-Fallback).
--   - SQL-Check bestätigt: 0 Zeilen mit projekt IS NOT NULL AND projectId IS
--     NULL — jeder vorhandene Freitextwert wurde in #5a entweder zu einem
--     Project migriert und verknüpft, oder war bereits NULL. Kein Datensatz
--     verliert durch diesen Drop Information.

-- AlterTable
ALTER TABLE "TimeEntry" DROP COLUMN "projekt";
