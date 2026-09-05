// Reine Validierungslogik für TimeEntry-Zeilen, kein Prisma (gleiches
// Trennungsprinzip wie lib/calc.ts) — aus app/api/time-entries/route.ts
// herausgezogen, weil app/api/time-entries/day/route.ts (Tages-Speichern,
// mehrere Zeilen auf einmal) dieselben Prüfungen pro Zeile braucht. Beide
// Routen importieren von hier, damit die Regeln nie auseinanderlaufen
// können.

import { EINTRAG_TYPEN, type EintragTyp } from "@/lib/calc";

export function isValidType(type: unknown): type is EintragTyp {
  return typeof type === "string" && (EINTRAG_TYPEN as readonly string[]).includes(type);
}

// "HH:MM", 00:00–23:59 — ein Wert wie "8" oder "25:00" darf nicht bis in
// stundenAusEintrag() (lib/calc.ts) durchlaufen und dort split(":").map(Number)
// zu NaN machen, das sich danach durch Monatssummen, Überzeit-Berechnung und
// Exporte frisst.
export function isValidTimeString(s: unknown): s is string {
  return typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

// Eine "arbeit"-Zeile ist gültig, wenn entweder BEIDE Zeiten ein valides
// HH:MM sind (der Normalfall — jede Zeile, die über den Tagesdialog
// gespeichert wird) ODER beide null sind und stattdessen eine Stundenzahl
// vorliegt (das reine hours-Format des Stundenrapport-Imports, siehe
// TimeEntry.countsAsWorktime in prisma/schema.prisma und
// stundenAusEintrag() in lib/calc.ts, die für diesen Fall auf `hours`
// zurückfällt). Jede andere Kombination — fehlende, halb gesetzte oder
// falsch formatierte Zeiten — ergäbe über stundenAusEintrag() stumm 0h oder
// NaN; das ist ein 400.
export function arbeitszeitIstGueltig(von: string | null, bis: string | null, hours: number | null): boolean {
  if (isValidTimeString(von) && isValidTimeString(bis)) return true;
  if (von == null && bis == null && hours != null) return true;
  return false;
}

// Sentinel statt eines dritten möglichen Rückgabewerts von Number() (NaN),
// damit ein ungültiger Wert nicht mit "kein Wert" (null) verwechselt werden
// kann. Math.max(0, Math.min(24, Number(hours))) bliebe bei NaN ebenfalls
// NaN, und arbeitszeitIstGueltig() liesse das durch, weil `NaN != null` wahr
// ist.
export const INVALID_HOURS = Symbol("INVALID_HOURS");

export function parseHours(raw: unknown): number | null | typeof INVALID_HOURS {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return INVALID_HOURS;
  return Math.max(0, Math.min(24, n));
}

// Netto-Minuten (bis − von − Pause, Mitternachts-Konvention wie
// stundenAusEintrag() in lib/calc.ts). Negativ, wenn die Pause länger ist
// als die eingetragene Zeitspanne.
export function nettoMinuten(von: string, bis: string, pauseMin: number): number {
  const [vh, vm] = von.split(":").map(Number);
  const [bh, bm] = bis.split(":").map(Number);
  let bisMin = bh * 60 + bm;
  const vonMin = vh * 60 + vm;
  if (bisMin < vonMin) bisMin += 24 * 60;
  return bisMin - vonMin - pauseMin;
}
