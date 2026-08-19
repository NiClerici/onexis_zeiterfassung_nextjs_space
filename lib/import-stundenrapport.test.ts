// Test für den reinen Parser (Stundenrapport-Import, siehe lib/import-stundenrapport.ts)
// — kein Prisma, keine Route. Prüft beide Einstiege (xlsx über ExcelJS,
// csv als String) gegen synthetische Fälle sowie gegen die echte
// Referenzdatei aus Nicos Postfach (Swissgrid, Juli 2026).

import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import ExcelJS from "exceljs";
import { parseStundenrapportWorkbook, parseStundenrapportCsv, parseStundenrapportGrid } from "@/lib/import-stundenrapport";

async function buildWorkbook(grid: (string | number)[][]): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Kunde");
  for (const row of grid) ws.addRow(row);
  return wb;
}

const HEADER_KOPF: string[][] = [
  ["Stundenrapport:", "", "Nico Clerici, ONEXIS GmbH"],
  ["Monat:", "", "Juli 2026"],
  ["Kunde:", "", "Swissgrid"],
  [],
  ["STD", "Projekt", "", "Betrag ohne MwSt"],
  ["", "Salesforce <> IAM", "", "0"],
  ["Total (o. MwSt)", "", "0"],
  [],
];

describe("parseStundenrapportGrid — Kernlogik", () => {
  it("liest Kunde/Monat aus dem Kopfblock und die Detailzeilen", () => {
    const grid = [
      ...HEADER_KOPF,
      ["Datum", "Kürzel", "Projekt", "Tasks", "Std"],
      ["01.07.2026", "CLN", "Salesforce <> IAM", "SPI und SF anbindung", "6,00"],
      ["06.07.2026", "CLN", "Salesforce <> IAM", "SPI bestellung", "7,00"],
      [],
      ["", "", "", "", "13,00"],
      ["TOTAL", "", "", "", "13,00"],
    ];
    const result = parseStundenrapportGrid(grid);

    expect(result.errors).toEqual([]);
    expect(result.customerName).toBe("Swissgrid");
    expect(result.year).toBe(2026);
    expect(result.month).toBe(7);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({ date: "2026-07-01", kuerzel: "CLN", projektName: "Salesforce <> IAM", task: "SPI und SF anbindung", hours: 6 });
  });

  it("normalisiert Whitespace im Projektnamen — zwei Schreibweisen ergeben EIN Projekt", () => {
    const grid = [
      ...HEADER_KOPF,
      ["Datum", "Kürzel", "Projekt", "Tasks", "Std"],
      ["13.07.2026", "CLN", "Salesforce <> IAM", "Script", "8,00"],
      ["14.07.2026", "CLN", "Salesforce <> IAM ", "Script", "6,00"], // Leerzeichen am Ende
      ["15.07.2026", "CLN", "Salesforce  <>   IAM", "Testing", "4,00"], // doppelte Leerzeichen
    ];
    const result = parseStundenrapportGrid(grid);

    expect(result.errors).toEqual([]);
    const distinctNames = new Set(result.rows.map((r) => r.projektName));
    expect(distinctNames.size).toBe(1);
    expect([...distinctNames][0]).toBe("Salesforce <> IAM");
  });

  it("erlaubt mehrere Projektzeilen am selben Datum", () => {
    const grid = [
      ...HEADER_KOPF,
      ["Datum", "Kürzel", "Projekt", "Tasks", "Std"],
      ["14.07.2026", "CLN", "Salesforce <> IAM", "Script", "6,00"],
      ["14.07.2026", "CLN", "Phy. Schutz UW", "Meetings UMS", "2,00"],
    ];
    const result = parseStundenrapportGrid(grid);

    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows.filter((r) => r.date === "2026-07-14")).toHaveLength(2);
  });

  it("überspringt Leerzeilen und die Summenzeile, ohne einen Fehler zu melden", () => {
    const grid = [
      ...HEADER_KOPF,
      ["Datum", "Kürzel", "Projekt", "Tasks", "Std"],
      ["01.07.2026", "CLN", "Salesforce <> IAM", "SPI", "6,00"],
      [],
      ["", "", "", "", "6,00"],
      ["TOTAL", "", "", "", "6,00"],
    ];
    const result = parseStundenrapportGrid(grid);

    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
  });

  it("meldet ein ungültiges Datum als Zeilenfehler, ohne die übrigen Zeilen zu blockieren", () => {
    const grid = [
      ...HEADER_KOPF,
      ["Datum", "Kürzel", "Projekt", "Tasks", "Std"],
      ["31.02.2026", "CLN", "Salesforce <> IAM", "SPI", "6,00"],
      ["02.07.2026", "CLN", "Salesforce <> IAM", "SPI", "7,00"],
    ];
    const result = parseStundenrapportGrid(grid);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toMatch(/Ungültiges Datum/);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].date).toBe("2026-07-02");
  });

  it("meldet eine ungültige Stundenzahl als Zeilenfehler", () => {
    const grid = [
      ...HEADER_KOPF,
      ["Datum", "Kürzel", "Projekt", "Tasks", "Std"],
      ["02.07.2026", "CLN", "Salesforce <> IAM", "SPI", "abc"],
    ];
    const result = parseStundenrapportGrid(grid);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toMatch(/Ungültige Stundenzahl/);
  });

  it("fehlende Detail-Kopfzeile ergibt einen Top-Level-Fehler, keine Zeilen", () => {
    const grid = [...HEADER_KOPF];
    const result = parseStundenrapportGrid(grid);
    expect(result.rows).toEqual([]);
    expect(result.errors).toHaveLength(1);
  });
});

describe("parseStundenrapportWorkbook — .xlsx-Einstieg", () => {
  it("liefert dasselbe Ergebnis wie parseStundenrapportGrid für ein echtes Workbook", async () => {
    const wb = await buildWorkbook([
      ...HEADER_KOPF,
      ["Datum", "Kürzel", "Projekt", "Tasks", "Std"],
      ["01.07.2026", "CLN", "Salesforce <> IAM", "SPI und SF anbindung", 6],
    ]);
    const result = parseStundenrapportWorkbook(wb);
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ date: "2026-07-01", hours: 6, projektName: "Salesforce <> IAM" });
  });
});

describe("parseStundenrapportCsv — .csv-Einstieg (ISO-8859-1, Semikolon, Komma-Dezimal)", () => {
  it("parst dieselben Werte wie das xlsx-Äquivalent", () => {
    const csv = [
      "Stundenrapport:;;Nico Clerici, ONEXIS GmbH",
      "Monat:;;Juli 2026",
      "Kunde:;;Swissgrid",
      "",
      "Datum;Kürzel;Projekt;Tasks;Std",
      "01.07.2026;CLN;Salesforce <> IAM;SPI und SF anbindung;6,00",
      "06.07.2026;CLN;Salesforce <> IAM ;SPI bestellung;7,00",
      ";;;;13,00",
      "TOTAL;;;;13,00",
    ].join("\n");

    const result = parseStundenrapportCsv(csv);

    expect(result.errors).toEqual([]);
    expect(result.customerName).toBe("Swissgrid");
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({ date: "2026-07-01", hours: 6, projektName: "Salesforce <> IAM" });
    expect(result.rows[1]).toMatchObject({ date: "2026-07-06", hours: 7, projektName: "Salesforce <> IAM" });
  });
});

describe("Echte Referenzdatei (Swissgrid, Juli 2026)", () => {
  const path = "/Users/nicoclerici/Documents/Arbeit/Zeiterfassung/ONEXIS_Stundenabbrechnung_April-26_NClerici(Swissgrid Juli).csv";

  it("91.00h auf 18 Zeilen / 13 Tage / genau 2 Projekte — unabhängig aus der Datei ausgezählt", () => {
    const buf = readFileSync(path);
    const text = buf.toString("latin1"); // ISO-8859-1
    const result = parseStundenrapportCsv(text);

    expect(result.errors).toEqual([]);
    expect(result.customerName).toBe("Swissgrid");
    expect(result.rows).toHaveLength(18);

    const totalHours = result.rows.reduce((s, r) => s + r.hours, 0);
    expect(totalHours).toBeCloseTo(91, 5);

    const distinctDates = new Set(result.rows.map((r) => r.date));
    expect(distinctDates.size).toBe(13);

    const byProjekt = new Map<string, number>();
    for (const r of result.rows) byProjekt.set(r.projektName, (byProjekt.get(r.projektName) ?? 0) + r.hours);
    expect(byProjekt.size).toBe(2);
    expect(byProjekt.get("Phy. Schutz UW")).toBeCloseTo(44, 5);
    expect(byProjekt.get("Salesforce <> IAM")).toBeCloseTo(47, 5);

    // Fünf Tage mit zwei Projektzeilen (14., 15., 20., 27., 29.07.).
    const countsByDate = new Map<string, number>();
    for (const r of result.rows) countsByDate.set(r.date, (countsByDate.get(r.date) ?? 0) + 1);
    const doubleDays = [...countsByDate.entries()].filter(([, n]) => n === 2).map(([d]) => d);
    expect(doubleDays.sort()).toEqual(["2026-07-14", "2026-07-15", "2026-07-20", "2026-07-27", "2026-07-29"]);
  });
});
