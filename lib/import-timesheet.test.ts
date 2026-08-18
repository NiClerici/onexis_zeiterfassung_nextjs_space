// Test für den reinen Parser (Betrieb.md Punkt 4) — kein Prisma, kein
// Server-Aufruf, nur ExcelJS.Workbook rein, Zeilen/Fehler raus.

import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { parseTimesheetWorkbook } from "@/lib/import-timesheet";

async function buildWorkbook(sheetName: string, headers: string[], data: (string | number | Date | null)[][]): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  ws.addRow(headers);
  for (const row of data) ws.addRow(row);
  return wb;
}

describe("parseTimesheetWorkbook — 4-Spalten-Altformat (Nicos Datei)", () => {
  it("parst Arbeitszeit/Ferien/Feiertag korrekt und leitet von/bis aus den Stunden ab", async () => {
    const wb = await buildWorkbook("Tageszeiten", ["Datum", "Wochentag", "Stunden", "Typ"], [
      ["01.04.2026", "Mittwoch", 6, "Arbeitszeit"],
      ["02.04.2026", "Donnerstag", 8, "Arbeitszeit"],
      ["03.04.2026", "Freitag", 4.8, "Feiertag"],
      ["06.04.2026", "Montag", 8, "Ferien"],
    ]);

    const { rows, errors } = parseTimesheetWorkbook(wb);

    expect(errors).toEqual([]);
    expect(rows).toHaveLength(4);

    expect(rows[0]).toMatchObject({ date: "2026-04-01", type: "arbeit", hours: 6, von: "08:00" });
    // 8h + 30min Pause ab 6h → 16:30 laut buildArbeitszeit
    expect(rows[1]).toMatchObject({ date: "2026-04-02", type: "arbeit", hours: 8, von: "08:00", bis: "16:30", pauseMin: 30 });
    expect(rows[2]).toMatchObject({ date: "2026-04-03", type: "feiertag", hours: 4.8, von: null, bis: null });
    expect(rows[3]).toMatchObject({ date: "2026-04-06", type: "ferien", hours: 8, von: null, bis: null });
  });

  it("Krankheit, Militär und Unbezahlt werden ebenfalls erkannt", async () => {
    const wb = await buildWorkbook("Tageszeiten", ["Datum", "Wochentag", "Stunden", "Typ"], [
      ["07.04.2026", "Dienstag", 8, "Krank"],
      ["08.04.2026", "Mittwoch", 8, "Militär"],
      ["09.04.2026", "Donnerstag", 0, "Unbezahlt"],
    ]);
    const { rows, errors } = parseTimesheetWorkbook(wb);
    expect(errors).toEqual([]);
    expect(rows.map((r) => r.type)).toEqual(["krank", "militaer", "unbezahlt"]);
  });
});

describe("parseTimesheetWorkbook — 8-Spalten-Format (heutiger Export)", () => {
  it("nutzt Von/Bis direkt, wenn vorhanden, und überspringt die Summenzeile", async () => {
    const wb = await buildWorkbook(
      "Tageszeiten",
      ["Datum", "Wochentag", "Von", "Bis", "Stunden", "Typ", "Kunde/Projekt", "Notiz"],
      [
        ["01.04.2026", "Mittwoch", "09:00", "17:30", 8, "Arbeitszeit", "Swissgrid", "Kickoff"],
        [null, null, null, "Total", 8, null, null, null],
      ]
    );

    const { rows, errors } = parseTimesheetWorkbook(wb);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ date: "2026-04-01", von: "09:00", bis: "17:30", notiz: "Kickoff" });
  });
});

describe("parseTimesheetWorkbook — Fehlerfälle", () => {
  it("meldet fehlende Pflichtspalten als einzelnen Fehler, keine Zeilen", async () => {
    const wb = await buildWorkbook("Tageszeiten", ["Datum", "Stunden"], [["01.04.2026", 8]]);
    const { rows, errors } = parseTimesheetWorkbook(wb);
    expect(rows).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/typ/i);
  });

  it("meldet ein fehlendes Blatt 'Tageszeiten'", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Zusammenfassung");
    const { rows, errors } = parseTimesheetWorkbook(wb);
    expect(rows).toEqual([]);
    expect(errors[0].message).toMatch(/Tageszeiten/);
  });

  it("meldet ungültiges Datum, unbekannten Typ und ungültige Stunden pro Zeile, überspringt aber nicht die restliche Datei", async () => {
    const wb = await buildWorkbook("Tageszeiten", ["Datum", "Wochentag", "Stunden", "Typ"], [
      ["31.02.2026", "—", 8, "Arbeitszeit"], // 31. Februar existiert nicht
      ["02.04.2026", "Donnerstag", 8, "Urlaub"], // unbekannter Typ (nicht "Ferien")
      ["03.04.2026", "Freitag", "abc", "Arbeitszeit"], // keine Zahl
      ["04.04.2026", "Samstag", 6, "Arbeitszeit"], // gültig
    ]);

    const { rows, errors } = parseTimesheetWorkbook(wb);
    expect(errors).toHaveLength(3);
    expect(errors.map((e) => e.rowNumber)).toEqual([2, 3, 4]);
    expect(rows).toHaveLength(1);
    expect(rows[0].date).toBe("2026-04-04");
  });

  it("leere Zeilen werden stillschweigend übersprungen, nicht als Fehler gezählt", async () => {
    const wb = await buildWorkbook("Tageszeiten", ["Datum", "Wochentag", "Stunden", "Typ"], [
      ["01.04.2026", "Mittwoch", 6, "Arbeitszeit"],
      [null, null, null, null],
      ["02.04.2026", "Donnerstag", 6, "Arbeitszeit"],
    ]);
    const { rows, errors } = parseTimesheetWorkbook(wb);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);
  });
});
