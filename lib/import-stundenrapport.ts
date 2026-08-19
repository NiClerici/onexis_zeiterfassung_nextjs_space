// Parser für den alten ONEXIS-Stundenrapport (ein Blatt/eine Datei pro Kunde
// und Monat, Format "ONEXIS_Stundenabbrechnung_<Monat>-<Jahr>_<Name>"), nicht
// zu verwechseln mit lib/import-timesheet.ts (Blatt "Tageszeiten", eine Zeile
// pro Tag). Dieses Format hat pro Tag potenziell MEHRERE Zeilen (ein Projekt
// pro Zeile) und einen Kopfblock mit Kunde/Monat/Projekt-Summen, den wir
// ignorieren — er ist aus den Detailzeilen ableitbar und schreibt
// Projektnamen teils abweichend (z.B. "Phys. Schutz UW" oben vs.
// "Phy. Schutz UW" unten in der Referenzdatei).
//
// Reine Funktion ohne Prisma-Zugriff, wie lib/import-timesheet.ts. Sowohl
// .xlsx (ExcelJS.Workbook) als auch .csv (Semikolon-getrennt, ISO-8859-1)
// werden zuerst auf ein gemeinsames Zellen-Raster (string[][]) reduziert —
// die eigentliche Parse-Logik (Kopf lesen, Detail-Kopfzeile suchen,
// Zeilen lesen) existiert dadurch nur einmal.

import type ExcelJS from "exceljs";

export interface ImportedProjektRow {
  rowNumber: number;
  date: string; // YYYY-MM-DD
  kuerzel: string | null;
  projektName: string; // normalisiert (Whitespace kollabiert, getrimmt)
  task: string | null;
  hours: number;
}

export interface ImportRowError {
  rowNumber: number;
  message: string;
}

export interface ParsedStundenrapport {
  customerName: string | null; // aus "Kunde:" im Kopf, nur ein Vorschlag
  year: number | null; // aus "Monat:" im Kopf, nur zur Plausibilisierung
  month: number | null;
  rows: ImportedProjektRow[];
  errors: ImportRowError[];
}

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

// Normalisiert Whitespace (mehrere Leerzeichen, Zeilenumbrüche, geschützte
// Leerzeichen) auf ein einzelnes Leerzeichen und trimmt. Zwingend für den
// Projektnamen-Abgleich: die Referenzdatei enthält "Salesforce <> IAM " (mit
// Leerzeichen am Ende, 5×) und "Salesforce <> IAM" (ohne, 4×) — ohne
// Normalisierung entstünden daraus zwei Projekte statt einem.
function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function parseHours(text: string): number | null {
  const t = text.replace(",", ".").trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const DATE_RE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;

function parseDate(text: string): string | null {
  const m = DATE_RE.exec(text.trim());
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseMonatZelle(text: string): { year: number | null; month: number | null } {
  // "Juli 2026" oder "07.2026" oder "2026-07" — wir nehmen, was sich lesen
  // lässt, und lassen beides auf null, wenn nichts passt (nur ein Hinweis
  // für die UI, keine Pflichtangabe).
  const t = text.trim().toLowerCase();
  const nameMatch = /^([a-zäöüß]+)\s+(\d{4})$/.exec(t);
  if (nameMatch && MONTH_NAME_TO_NUM[nameMatch[1]] !== undefined) {
    return { year: Number(nameMatch[2]), month: MONTH_NAME_TO_NUM[nameMatch[1]] };
  }
  const numMatch = /^(\d{1,2})[.\-/](\d{4})$/.exec(t);
  if (numMatch) {
    const m = Number(numMatch[1]);
    if (m >= 1 && m <= 12) return { year: Number(numMatch[2]), month: m };
  }
  const isoMatch = /^(\d{4})[.\-/](\d{1,2})$/.exec(t);
  if (isoMatch) {
    const m = Number(isoMatch[2]);
    if (m >= 1 && m <= 12) return { year: Number(isoMatch[1]), month: m };
  }
  return { year: null, month: null };
}

// Zellen defensiv als String lesen — Grid-Einträge sind vertraglich Strings,
// aber sowohl handgeschriebene Testraster als auch künftige xlsx-Varianten
// könnten rohe Zahlen enthalten (z.B. eine Formel-Summe); ohne die Koerzierung
// crasht ein .trim() auf einer number.
function cell(row: string[], idx: number): string {
  const v = row[idx];
  return v === undefined || v === null ? "" : String(v);
}

// Eine Zelle ist "leer", wenn sie nach dem Trimmen nichts enthält — dient dem
// Erkennen von Leerzeilen und dem Ende des Detailblocks.
function rowIsBlank(row: string[]): boolean {
  return row.every((c) => String(c ?? "").trim() === "");
}

function rowContains(row: string[], needleLower: string): boolean {
  return row.some((c) => String(c ?? "").trim().toLowerCase() === needleLower);
}

// Kernlogik auf einem bereits in Zellen zerlegten Raster — von xlsx- und
// csv-Einstieg gemeinsam genutzt.
export function parseStundenrapportGrid(grid: string[][]): ParsedStundenrapport {
  let customerName: string | null = null;
  let year: number | null = null;
  let month: number | null = null;

  // Detail-Kopfzeile per Suche finden (nie über eine feste Zeilennummer,
  // gleiche Regel wie lib/import-timesheet.ts / BETRIEB.md Punkt 4): die
  // Zeile, die sowohl "Datum" als auch "Std" als eigene Zelle enthält.
  let headerRowIdx = -1;
  for (let i = 0; i < grid.length; i++) {
    const row = grid[i];
    if (rowContains(row, "datum") && rowContains(row, "std")) {
      headerRowIdx = i;
      break;
    }
  }

  if (headerRowIdx === -1) {
    return {
      customerName: null,
      year: null,
      month: null,
      rows: [],
      errors: [{ rowNumber: 0, message: 'Keine Detail-Kopfzeile mit "Datum" und "Std" gefunden.' }],
    };
  }

  // Kopfblock (alles oberhalb der Detail-Kopfzeile): "Kunde:" / "Monat:"
  // suchen, unabhängig von der Spaltenposition (Label und Wert stehen in der
  // Referenzdatei in unterschiedlichen Spalten je nach Zeile).
  for (let i = 0; i < headerRowIdx; i++) {
    const row = grid[i];
    for (let c = 0; c < row.length; c++) {
      const label = cell(row, c).trim().toLowerCase();
      if (label === "kunde:" || label === "kunde") {
        const value = row.slice(c + 1).map((v) => String(v ?? "")).find((v) => v.trim() !== "");
        if (value) customerName = value.trim();
      } else if (label === "monat:" || label === "monat") {
        const value = row.slice(c + 1).map((v) => String(v ?? "")).find((v) => v.trim() !== "");
        if (value) {
          const parsed = parseMonatZelle(value);
          year = parsed.year;
          month = parsed.month;
        }
      }
    }
  }

  const headerRow = grid[headerRowIdx].map((c) => String(c ?? "").trim().toLowerCase());
  const columns: Record<string, number> = {};
  headerRow.forEach((h, idx) => {
    if (h) columns[h] = idx;
  });
  const required = ["datum", "kürzel", "projekt", "tasks", "std"];
  const missing = required.filter((r) => !(r in columns));
  if (missing.length > 0) {
    return {
      customerName,
      year,
      month,
      rows: [],
      errors: [{ rowNumber: headerRowIdx + 1, message: `Detail-Tabelle: Pflichtspalte(n) fehlen: ${missing.join(", ")}.` }],
    };
  }

  const datumCol = columns["datum"];
  const kuerzelCol = columns["kürzel"];
  const projektCol = columns["projekt"];
  const tasksCol = columns["tasks"];
  const stdCol = columns["std"];

  const rows: ImportedProjektRow[] = [];
  const errors: ImportRowError[] = [];

  for (let i = headerRowIdx + 1; i < grid.length; i++) {
    const row = grid[i];
    const rowNumber = i + 1;
    if (rowIsBlank(row)) continue;
    if (rowContains(row, "total")) continue; // Summenzeile, kein Fehler

    const datumRaw = cell(row, datumCol);
    const stdRaw = cell(row, stdCol);
    const projektRaw = cell(row, projektCol);
    // Zeile ohne Datum UND ohne Projekt — überspringen statt als Fehler zu
    // melden. Deckt echte Leerzeilen ab, aber auch die von Excel erzeugte
    // Spaltensumme direkt vor der "TOTAL"-Zeile (nur eine Zahl in der
    // Std-Spalte, kein "TOTAL"-Text, kein Datum, kein Projekt — siehe
    // Referenzdatei). Eine Zeile MIT Projekt, aber ohne Datum, ist dagegen
    // eine echte kaputte Zeile und wird unten als Fehler gemeldet.
    if (!datumRaw.trim() && !projektRaw.trim()) continue;

    const date = parseDate(datumRaw);
    if (!date) {
      errors.push({ rowNumber, message: `Ungültiges Datum: "${datumRaw.trim()}".` });
      continue;
    }

    const projektName = normalizeWhitespace(projektRaw);
    if (!projektName) {
      errors.push({ rowNumber, message: "Projekt fehlt." });
      continue;
    }

    const hours = parseHours(stdRaw);
    if (hours === null || hours < 0 || hours > 24) {
      errors.push({ rowNumber, message: `Ungültige Stundenzahl: "${stdRaw.trim()}".` });
      continue;
    }

    const kuerzel = cell(row, kuerzelCol).trim() || null;
    const task = cell(row, tasksCol).trim() || null;

    rows.push({ rowNumber, date, kuerzel, projektName, task, hours });
  }

  return { customerName, year, month, rows, errors };
}

// Arbeitsblatt in ein string[][]-Raster wandeln — gemeinsam genutzt von
// parseStundenrapportWorkbook (erstes Blatt) und
// parseStundenrapportWorkbookAllSheets (alle Blätter).
function worksheetToGrid(sheet: ExcelJS.Worksheet): string[][] {
  const grid: string[][] = [];
  const lastCol = sheet.columnCount;
  for (let r = 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const cells: string[] = [];
    for (let c = 1; c <= lastCol; c++) {
      const v = row.getCell(c).value;
      cells.push(cellText(v));
    }
    grid.push(cells);
  }
  return grid;
}

// .xlsx-Einstieg (Einzelblatt, erstes Blatt) — für Aufrufer, die bewusst nur
// EIN Blatt lesen wollen (heutige Unit-Tests). Reale Dateien haben oft
// mehrere Blätter (ein Monat pro Blatt, siehe
// parseStundenrapportWorkbookAllSheets) — dafür NICHT diese Funktion
// verwenden, sonst gehen die übrigen Blätter stillschweigend verloren.
export function parseStundenrapportWorkbook(workbook: ExcelJS.Workbook): ParsedStundenrapport {
  const sheet = workbook.worksheets[0];
  if (!sheet) {
    return { customerName: null, year: null, month: null, rows: [], errors: [{ rowNumber: 0, message: "Datei enthält kein Arbeitsblatt." }] };
  }
  return parseStundenrapportGrid(worksheetToGrid(sheet));
}

// .xlsx-Einstieg (alle Blätter) — der Regelfall: ein Workbook mit einem
// Blatt pro Monat (z.B. "Swissgrid April", "Swissgrid Mai", ...), alle für
// denselben oder auch unterschiedliche Kunden. Jedes Blatt wird unabhängig
// über parseStundenrapportGrid geparst (eigener Kopfblock, eigene
// Detailzeilen). Blätter OHNE erkennbare Detail-Kopfzeile (kein "Datum" +
// "Std") werden übersprungen statt einen Fehler zu erzeugen — deckt z.B.
// eine zusätzliche Notiz-/Deckblatt-Seite im selben Workbook ab, ohne die
// übrigen, echten Blätter zu blockieren.
export function parseStundenrapportWorkbookAllSheets(workbook: ExcelJS.Workbook): { sheetName: string; parsed: ParsedStundenrapport }[] {
  const results: { sheetName: string; parsed: ParsedStundenrapport }[] = [];
  for (const sheet of workbook.worksheets) {
    const grid = worksheetToGrid(sheet);
    if (!grid.some((row) => rowContains(row, "datum") && rowContains(row, "std"))) continue;
    results.push({ sheetName: sheet.name, parsed: parseStundenrapportGrid(grid) });
  }
  return results;
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) {
    const y = v.getUTCFullYear();
    const m = v.getUTCMonth() + 1;
    const d = v.getUTCDate();
    return `${String(d).padStart(2, "0")}.${String(m).padStart(2, "0")}.${y}`;
  }
  if (typeof v === "object") {
    const anyV = v as any;
    if (anyV.richText) return anyV.richText.map((t: any) => t.text ?? "").join("");
    if (anyV.text !== undefined) return String(anyV.text ?? "");
    if (anyV.result !== undefined) return String(anyV.result ?? "");
  }
  return String(v);
}

// .csv-Einstieg: erwartet bereits als JS-String dekodierten Text (die Route
// liest den Upload als Buffer und dekodiert ihn als ISO-8859-1 — die
// Referenzdatei ist latin1, ä/ü wären als UTF-8 gelesen sonst kaputt).
// Semikolon-getrennt, keine Anführungszeichen-Maskierung ausser dem
// einfachen '"..."'-Fall, den die Referenzdatei für mehrzeilige Projekt-
// Zellen im (hier ignorierten) Kopfblock nutzt.
export function parseStundenrapportCsv(text: string): ParsedStundenrapport {
  const grid = csvToGrid(text);
  return parseStundenrapportGrid(grid);
}

// Minimaler CSV-Parser mit Anführungszeichen-Unterstützung (für mehrzeilige
// Zellen im Kopfblock der Referenzdatei) — kein externes Paket nötig für ein
// so kleines, festes Format (Semikolon, doppelte Anführungszeichen).
function csvToGrid(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (inQuotes) {
      if (ch === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ";") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
