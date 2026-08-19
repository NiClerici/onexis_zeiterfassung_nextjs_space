// Parser für den Excel-Import alter Jahresexporte (Betrieb.md Punkt 4).
// Reine Funktion ohne Prisma-Zugriff, wie lib/calc.ts — ein ExcelJS.Workbook
// rein, geprüfte Zeilen plus Fehlerliste raus. Die Konfliktprüfung gegen
// vorhandene Einträge und gesperrte Monate braucht die Datenbank und liegt
// deshalb in app/api/import/timesheet/route.ts, nicht hier.
//
// Der Alt-Export hat nur 4 Spalten (Datum, Wochentag, Stunden, Typ) — der
// heutige Export (app/api/export/route.ts) schreibt 8 (zusätzlich Von, Bis,
// Kunde/Projekt, Notiz). Deshalb wird über Spaltenüberschriften gelesen,
// nie über Positionen, und fehlende Spalten werden toleriert.

import type ExcelJS from "exceljs";
import type { EintragTyp } from "@/lib/calc";
import { TYPE_LABELS } from "@/lib/export-helpers";
import { buildArbeitszeit } from "@/lib/arbeitszeit";

const SHEET_NAME = "Tageszeiten";

// Umkehrung von TYPE_LABELS ("Arbeitszeit" → "arbeit"), case-insensitiv.
const LABEL_TO_TYPE: Record<string, EintragTyp> = Object.fromEntries(
  Object.entries(TYPE_LABELS).map(([type, label]) => [label.toLowerCase(), type as EintragTyp])
);

export interface ImportedRow {
  rowNumber: number;
  date: string; // YYYY-MM-DD
  type: EintragTyp;
  hours: number;
  von: string | null;
  bis: string | null;
  pauseMin: number;
  notiz: string | null;
}

export interface ImportRowError {
  rowNumber: number;
  message: string;
}

export interface ParsedTimesheet {
  rows: ImportedRow[];
  errors: ImportRowError[];
}

// Zweiter Parser für das Blatt "Kundenstunden" des Alt-Exports (Betrieb.md
// Punkt 4, Nachtrag nach der Umstellung auf CustomerMonth) — Format
// Jahr | Monat | Kunde | Stunden, eine Zeile pro Monat/Kunde-Kombination.
// Anders als Tageszeiten ist dieses Blatt optional: fehlt es, gibt es
// einfach nichts zu importieren, kein Fehler.

const CUSTOMER_MONTH_SHEET_NAME = "Kundenstunden";

const MONTH_NAME_TO_NUM: Record<string, number> = {
  januar: 1, jan: 1,
  februar: 2, feb: 2,
  märz: 3, maerz: 3, mär: 3, mrz: 3,
  april: 4, apr: 4,
  mai: 5,
  juni: 6, jun: 6,
  juli: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  oktober: 10, okt: 10,
  november: 11, nov: 11,
  dezember: 12, dez: 12,
};

function parseMonth(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 12) return value;
  const text = cellText(value).toLowerCase();
  if (!text) return null;
  if (MONTH_NAME_TO_NUM[text] !== undefined) return MONTH_NAME_TO_NUM[text];
  const n = Number(text);
  if (Number.isInteger(n) && n >= 1 && n <= 12) return n;
  return null;
}

function parseYear(value: unknown): number | null {
  const text = cellText(value);
  const n = typeof value === "number" ? value : Number(text);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 2000 || n > 2100) return null;
  return n;
}

export interface CustomerRef {
  id: string;
  name: string;
}

export interface ImportedCustomerMonthRow {
  rowNumber: number;
  year: number;
  month: number;
  customerId: string;
  customerName: string;
  hours: number;
}

export interface ParsedCustomerMonths {
  rows: ImportedCustomerMonthRow[];
  errors: ImportRowError[];
}

export function parseCustomerMonthsWorkbook(workbook: ExcelJS.Workbook, customers: CustomerRef[]): ParsedCustomerMonths {
  const sheet = workbook.worksheets.find((ws) => ws.name.trim().toLowerCase() === CUSTOMER_MONTH_SHEET_NAME.toLowerCase());
  if (!sheet) return { rows: [], errors: [] };

  const headerRow = sheet.getRow(1);
  const columns: Record<string, number> = {};
  const lastCol = Math.max(sheet.columnCount, headerRow.cellCount);
  for (let c = 1; c <= lastCol; c++) {
    const header = normalizeHeader(headerRow.getCell(c).value);
    if (header) columns[header] = c;
  }

  const required = ["jahr", "monat", "kunde", "stunden"];
  const missing = required.filter((r) => !(r in columns));
  if (missing.length > 0) {
    return { rows: [], errors: [{ rowNumber: 1, message: `Blatt "${CUSTOMER_MONTH_SHEET_NAME}": Pflichtspalte(n) fehlen: ${missing.join(", ")}.` }] };
  }

  const jahrCol = columns["jahr"];
  const monatCol = columns["monat"];
  const kundeCol = columns["kunde"];
  const stundenCol = columns["stunden"];

  // Case-insensitiver Namensabgleich gegen bestehende Kunden der Organisation
  // — unbekannter Kunde ist ein Zeilenfehler, kein automatisches Anlegen
  // (sonst wächst die Kundenliste durch Tippfehler im Altsystem zu).
  const byLowerName = new Map<string, CustomerRef>();
  for (const c of customers) {
    const key = c.name.trim().toLowerCase();
    if (!byLowerName.has(key)) byLowerName.set(key, c);
  }

  const rows: ImportedCustomerMonthRow[] = [];
  const errors: ImportRowError[] = [];

  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const jahrRaw = row.getCell(jahrCol).value;
    const monatRaw = row.getCell(monatCol).value;
    const kundeRaw = row.getCell(kundeCol).value;

    if (!cellText(jahrRaw) && !cellText(monatRaw) && !cellText(kundeRaw)) continue; // Leerzeile
    if (isTotalRow(row, lastCol)) continue;

    const year = parseYear(jahrRaw);
    if (year === null) {
      errors.push({ rowNumber: r, message: `Ungültiges Jahr: "${cellText(jahrRaw)}".` });
      continue;
    }
    const month = parseMonth(monatRaw);
    if (month === null) {
      errors.push({ rowNumber: r, message: `Ungültiger Monat: "${cellText(monatRaw)}".` });
      continue;
    }
    const kundeName = cellText(kundeRaw);
    const customer = byLowerName.get(kundeName.toLowerCase());
    if (!customer) {
      errors.push({ rowNumber: r, message: `Unbekannter Kunde: "${kundeName}".` });
      continue;
    }
    const hours = parseHours(row.getCell(stundenCol).value);
    if (hours === null || hours < 0 || hours > 800) {
      errors.push({ rowNumber: r, message: `Ungültige Stundenzahl: "${cellText(row.getCell(stundenCol).value)}".` });
      continue;
    }

    rows.push({ rowNumber: r, year, month, customerId: customer.id, customerName: customer.name, hours });
  }

  return { rows, errors };
}

function normalizeHeader(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && "text" in (v as any)) return String((v as any).text ?? "").trim();
  return String(v).trim();
}

function isTotalRow(row: ExcelJS.Row, lastCol: number): boolean {
  for (let c = 1; c <= lastCol; c++) {
    if (cellText(row.getCell(c).value).toLowerCase() === "total") return true;
  }
  return false;
}

const DATE_RE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;

function parseDate(value: unknown): string | null {
  if (value instanceof Date) {
    const y = value.getUTCFullYear();
    const m = value.getUTCMonth() + 1;
    const d = value.getUTCDate();
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  const text = cellText(value);
  const m = DATE_RE.exec(text);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseHours(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = cellText(value).replace(",", ".");
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

function parseTimeOfDay(value: unknown): string | null {
  const text = cellText(value);
  return TIME_RE.test(text) ? text : null;
}

export function parseTimesheetWorkbook(workbook: ExcelJS.Workbook): ParsedTimesheet {
  const sheet = workbook.worksheets.find((ws) => ws.name.trim().toLowerCase() === SHEET_NAME.toLowerCase());
  if (!sheet) {
    return { rows: [], errors: [{ rowNumber: 0, message: `Kein Blatt "${SHEET_NAME}" in der Datei gefunden.` }] };
  }

  const headerRow = sheet.getRow(1);
  const columns: Record<string, number> = {};
  const lastCol = Math.max(sheet.columnCount, headerRow.cellCount);
  for (let c = 1; c <= lastCol; c++) {
    const header = normalizeHeader(headerRow.getCell(c).value);
    if (header) columns[header] = c;
  }

  const required = ["datum", "stunden", "typ"];
  const missing = required.filter((r) => !(r in columns));
  if (missing.length > 0) {
    return {
      rows: [],
      errors: [{ rowNumber: 1, message: `Pflichtspalte(n) fehlen: ${missing.join(", ")}.` }],
    };
  }

  const datumCol = columns["datum"];
  const stundenCol = columns["stunden"];
  const typCol = columns["typ"];
  const vonCol = columns["von"];
  const bisCol = columns["bis"];
  const notizCol = columns["notiz"];

  const rows: ImportedRow[] = [];
  const errors: ImportRowError[] = [];

  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const datumRaw = row.getCell(datumCol).value;
    const typRaw = row.getCell(typCol).value;

    // Leerzeile überspringen — kein Fehler.
    if (!cellText(datumRaw) && !cellText(typRaw)) continue;
    // Summenzeile ("Total" in irgendeiner Zelle, wie im heutigen Export,
    // app/api/export/route.ts) überspringen — kein Fehler.
    if (isTotalRow(row, lastCol)) continue;

    const date = parseDate(datumRaw);
    if (!date) {
      errors.push({ rowNumber: r, message: `Ungültiges Datum: "${cellText(datumRaw)}".` });
      continue;
    }

    const typLabel = cellText(typRaw);
    const type = LABEL_TO_TYPE[typLabel.toLowerCase()];
    if (!type) {
      errors.push({ rowNumber: r, message: `Unbekannter Typ: "${typLabel}".` });
      continue;
    }

    const hours = parseHours(row.getCell(stundenCol).value);
    if (hours === null || hours < 0 || hours > 24) {
      errors.push({ rowNumber: r, message: `Ungültige Stundenzahl: "${cellText(row.getCell(stundenCol).value)}".` });
      continue;
    }

    const notiz = notizCol ? cellText(row.getCell(notizCol).value) || null : null;

    if (type === "arbeit") {
      const vonFile = vonCol ? parseTimeOfDay(row.getCell(vonCol).value) : null;
      const bisFile = bisCol ? parseTimeOfDay(row.getCell(bisCol).value) : null;
      if (vonFile && bisFile) {
        const [vh, vm] = vonFile.split(":").map(Number);
        const [bh, bm] = bisFile.split(":").map(Number);
        let bisMin = bh * 60 + bm;
        const vonMin = vh * 60 + vm;
        if (bisMin < vonMin) bisMin += 24 * 60;
        const pauseMin = Math.max(0, Math.round(bisMin - vonMin - hours * 60));
        rows.push({ rowNumber: r, date, type, hours, von: vonFile, bis: bisFile, pauseMin, notiz });
      } else {
        const { von, bis, pauseMin } = buildArbeitszeit(hours);
        rows.push({ rowNumber: r, date, type, hours, von, bis, pauseMin, notiz });
      }
    } else {
      rows.push({ rowNumber: r, date, type, hours, von: null, bis: null, pauseMin: 0, notiz });
    }
  }

  return { rows, errors };
}
