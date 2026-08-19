// Gemeinsame, Prisma-arme Hilfsfunktionen für die drei Export-Routen
// (/api/export, /api/export/arg-control, /api/export/payroll — MIGRATION.md
// Punkt 7). In lib/ statt in einer der Routen, damit keine der drei Routen
// exportierte Hilfsfunktionen aus einer anderen Route-Datei importieren muss
// (app/api/**/route.ts darf laut Next.js App Router nur HTTP-Handler und
// wenige Config-Exports exportieren).

import ExcelJS from "exceljs";
import { AccessError } from "@/lib/access";
import type { Profil, PensumChangeInput, EintragMitDatum } from "@/lib/calc";

// Profil.pensum/.wochenstunden sind in lib/calc.ts der Fallback von pensumAt()
// für Daten VOR der ersten PensumChange — also die historische Basis, nicht der
// aktuelle Wert. membership.pensum/weeklyHours werden von /api/pensum-changes
// bei jeder Änderung auf den neuesten Stand überschrieben; die Basis liegt in
// basePensum/baseWeeklyHours. Gleiches Muster wie in bulk-vacation/route.ts.
export function buildProfil(membership: any): Profil {
  return {
    pensum: membership?.basePensum ?? membership?.pensum ?? 100,
    wochenstunden: membership?.baseWeeklyHours ?? membership?.weeklyHours ?? 42,
    startDate: membership?.startDate ?? null,
    exitDate: membership?.exitDate ?? null,
    ferientage: membership?.vacationDays ?? 25,
    maxWeeklyHours: membership?.org?.maxWeeklyHours ?? 45,
  };
}

export function mapChanges(changes: any[]): PensumChangeInput[] {
  return changes.map((c) => ({ effectiveFrom: c.effectiveFrom, pensum: c.pensum, wochenstunden: c.weeklyHours }));
}

export function mapEintraege(entries: any[]): EintragMitDatum[] {
  return entries.map((e) => ({
    date: e.date,
    typ: e.type,
    von: e.von,
    bis: e.bis,
    pauseMin: e.pauseMin,
    hours: e.hours,
  }));
}

// Ungültige Zeitraum-Parameter sind ein Eingabefehler des Aufrufers und
// müssen 400 liefern, nicht 500 (HARDENING.md B2). AccessError ist die
// Fehlerklasse, die alle vier aufrufenden Routen in ihrem catch bereits auf
// den passenden Status abbilden — deshalb hier dieselbe statt einer eigenen,
// die jede Route einzeln behandeln müsste. Der Import verletzt die
// "Prisma-arm"-Absicht dieser Datei nicht in der Praxis: alle Aufrufer
// importieren @/lib/access ohnehin.
function assertGueltigesDatum(d: Date, was: string): Date {
  if (Number.isNaN(d.getTime())) {
    throw new AccessError(400, `Ungültiger Zeitraum: ${was} ist kein gültiges Datum.`);
  }
  return d;
}

// year/month aus den Query-Parametern, validiert. Gleiche Grenzen wie
// parseYearMonth in app/api/month-locks/route.ts:7-15, damit "was ist ein
// gültiger Monat" nicht an mehreren Stellen unterschiedlich beantwortet wird.
// Ohne diese Prüfung ergab year=abc ein Invalid Date, das erst in der
// Prisma-Query als 500 auffiel, und month=99 einen still um Jahre
// verschobenen Zeitraum (HARDENING.md B2). Zwei Aufrufer: parseExportRange
// hier und der Lohnexport, der bewusst immer monatsweise arbeitet und
// deshalb nicht parseExportRange verwendet.
export function parseYearMonthFromUrl(url: URL): { year: number; month: number } {
  const now = new Date();
  const year = parseInt(url?.searchParams?.get?.("year") ?? String(now.getFullYear()));
  const month = parseInt(url?.searchParams?.get?.("month") ?? String(now.getMonth() + 1));
  if (!Number.isFinite(year) || year < 2000 || year > 2100) {
    throw new AccessError(400, "Ungültiger Zeitraum: year muss zwischen 2000 und 2100 liegen.");
  }
  if (!Number.isFinite(month) || month < 1 || month > 12) {
    throw new AccessError(400, "Ungültiger Zeitraum: month muss zwischen 1 und 12 liegen.");
  }
  return { year, month };
}

// type=month|year|custom — identische Zeitraum-Logik für alle drei
// Export-Routen (vorher nur in /api/export dupliziert vorhanden).
export function parseExportRange(url: URL): { startDate: Date; endDate: Date } {
  const type = url?.searchParams?.get?.("type") ?? "month";
  const { year, month } = parseYearMonthFromUrl(url);

  // UTC-Grenzen: @db.Date-Werte werden anhand des UTC-Kalendertags gespeichert/verglichen.
  // Lokale Date-Konstruktoren würden in Zeitzonen ≠ UTC den letzten Tag der Periode abschneiden.
  if (type === "month") {
    return { startDate: new Date(Date.UTC(year, month - 1, 1)), endDate: new Date(Date.UTC(year, month, 0)) };
  } else if (type === "year") {
    return { startDate: new Date(Date.UTC(year, 0, 1)), endDate: new Date(Date.UTC(year, 11, 31)) };
  } else {
    const fromStr = url?.searchParams?.get?.("from") ?? "";
    const toStr = url?.searchParams?.get?.("to") ?? "";
    return {
      startDate: fromStr ? assertGueltigesDatum(new Date(fromStr), "from") : new Date(Date.UTC(year, 0, 1)),
      endDate: toStr ? assertGueltigesDatum(new Date(toStr), "to") : new Date(Date.UTC(year, 11, 31)),
    };
  }
}

export const fmtDate = (d: Date) => {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
};

export const TYPE_LABELS: Record<string, string> = {
  arbeit: "Arbeitszeit",
  ferien: "Ferien",
  krank: "Krank",
  feiertag: "Feiertag",
  militaer: "Militär",
  unbezahlt: "Unbezahlt",
};

export const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A56DB" } };
export const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
export const LABEL_FONT: Partial<ExcelJS.Font> = { bold: true, size: 11 };
export const BORDER_THIN: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFD0D0D0" } },
  bottom: { style: "thin", color: { argb: "FFD0D0D0" } },
  left: { style: "thin", color: { argb: "FFD0D0D0" } },
  right: { style: "thin", color: { argb: "FFD0D0D0" } },
};

export function styleHeaderRow(row: ExcelJS.Row, colCount: number) {
  for (let i = 1; i <= colCount; i++) {
    const cell = row.getCell(i);
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.border = BORDER_THIN;
    cell.alignment = { vertical: "middle", horizontal: "center" };
  }
  row.height = 24;
}

export function styleDataRow(row: ExcelJS.Row, colCount: number) {
  for (let i = 1; i <= colCount; i++) {
    const cell = row.getCell(i);
    cell.border = BORDER_THIN;
    cell.alignment = { vertical: "middle" };
  }
}
