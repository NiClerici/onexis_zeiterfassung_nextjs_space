// Feldweises Änderungsprotokoll für TimeEntry (MIGRATION.md Punkt 6b).
// Reine Diff-Logik hier, DB-Schreiben separat — analog zu lib/calc.ts, das
// die Berechnung von der Route trennt, damit die Diff-Logik ohne Prisma
// getestet werden kann.

export const AUDITED_TIME_ENTRY_FIELDS = [
  "date",
  "type",
  "von",
  "bis",
  "pauseMin",
  "notiz",
  "customerId",
  "projectId",
  "billable",
  "hours",
] as const;

export type AuditedTimeEntryField = (typeof AUDITED_TIME_ENTRY_FIELDS)[number];

export interface FieldChange {
  field: string;
  oldValue: string | null;
  newValue: string | null;
}

// Normalisiert einen Feldwert auf einen vergleichbaren String — Date wird auf
// den UTC-Kalendertag reduziert (wie überall sonst in der App, siehe
// lib/calc.ts toUTCDate), damit ein unverändertes Datum nicht wegen
// abweichender Uhrzeitanteile fälschlich als Änderung erkannt wird.
function serializeFieldValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

// Vergleicht die auditierten Felder zweier Zustände desselben TimeEntry und
// liefert nur die tatsächlich geänderten Felder. before/after tragen die
// bereits final aufgelösten Werte (nach allen Fallbacks auf bestehende
// Werte) — nicht den rohen Request-Body.
export function diffTimeEntryFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const field of AUDITED_TIME_ENTRY_FIELDS) {
    const oldValue = serializeFieldValue(before[field]);
    const newValue = serializeFieldValue(after[field]);
    if (oldValue !== newValue) {
      changes.push({ field, oldValue, newValue });
    }
  }
  return changes;
}
