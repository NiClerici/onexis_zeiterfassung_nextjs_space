// V5: Baut eine echte .xlsx im Speicher und lässt den ausgelieferten Parser
// darüberlaufen. Keine DB, keine Dateien auf der Platte.
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { parseTimesheetWorkbook } from "@/lib/import-timesheet";

async function wb(rows: any[][]) {
  const w = new ExcelJS.Workbook();
  const s = w.addWorksheet("Tageszeiten");
  s.addRow(["Datum", "Wochentag", "Stunden", "Typ", "Von", "Bis", "Notiz"]);
  rows.forEach((r) => s.addRow(r));
  // Über einen Puffer round-trippen, damit es eine echte xlsx ist
  const buf = await w.xlsx.writeBuffer();
  const w2 = new ExcelJS.Workbook();
  await w2.xlsx.load(buf as any);
  return w2;
}

describe("MITTEL: 'total' in irgendeiner Zelle verwirft die Zeile stumm", () => {
  it("BUG: reguläre Arbeitszeile mit Notiz 'Total' verschwindet ohne Fehler", async () => {
    const r = parseTimesheetWorkbook(await wb([
      ["11.08.2026", "Di", 8, "Arbeitszeit", "08:00", "16:30", "Normal"],
      ["12.08.2026", "Mi", 8, "Arbeitszeit", "08:00", "16:30", "Total"],
    ]));
    console.log(`  -> geparste Zeilen: ${r.rows.length}, Fehler: ${r.errors.length}`);
    console.log(`  -> importierte Daten: ${r.rows.map((x) => x.date).join(", ")}`);
    expect(r.rows).toHaveLength(1);          // die zweite Zeile fehlt
    expect(r.errors).toHaveLength(0);        // ...ohne jede Meldung
    expect(r.rows[0].date).toBe("2026-08-11");
  });
});

describe("MITTEL: Formelzellen werden zu '[object Object]'", () => {
  it("BUG: Stundenspalte als Formel -> unbrauchbare Fehlermeldung", async () => {
    const w = new ExcelJS.Workbook();
    const s = w.addWorksheet("Tageszeiten");
    s.addRow(["Datum", "Stunden", "Typ"]);
    const row = s.addRow(["11.08.2026", null, "Arbeitszeit"]);
    row.getCell(2).value = { formula: "4*2", result: 8 } as any;
    const buf = await w.xlsx.writeBuffer();
    const w2 = new ExcelJS.Workbook();
    await w2.xlsx.load(buf as any);

    const r = parseTimesheetWorkbook(w2);
    console.log(`  -> Fehlermeldung: ${r.errors[0]?.message}`);
    expect(r.rows).toHaveLength(0);
    expect(r.errors[0].message).toContain("[object Object]");
  });
});

describe("MITTEL: widersprüchliche Von/Bis vs. Stunden werden stumm umgedeutet", () => {
  it("BUG: Datei sagt 6h bei 08:00-12:00 -> gespeichert werden 4h, ohne Warnung", async () => {
    const r = parseTimesheetWorkbook(await wb([
      ["11.08.2026", "Di", 6, "Arbeitszeit", "08:00", "12:00", ""],
    ]));
    const row = r.rows[0];
    const effektiv = (12 * 60 - 8 * 60 - row.pauseMin) / 60;
    console.log(`  -> Datei sagt: ${row.hours}h | gespeichert wird: ${effektiv}h | Pause: ${row.pauseMin} | Fehler: ${r.errors.length}`);
    expect(row.hours).toBe(6);
    expect(effektiv).toBe(4);        // die tatsächlich zählende Zeit
    expect(r.errors).toHaveLength(0); // keine Warnung
  });
});

describe("MITTEL: keine Duplikatprüfung innerhalb der Datei", () => {
  it("BUG: derselbe Tag zweimal identisch -> beide Zeilen werden übernommen", async () => {
    const r = parseTimesheetWorkbook(await wb([
      ["12.03.2024", "Di", 8, "Arbeitszeit", "08:00", "16:30", ""],
      ["12.03.2024", "Di", 8, "Arbeitszeit", "08:00", "16:30", ""],
    ]));
    console.log(`  -> Zeilen: ${r.rows.length} (beide fuer ${r.rows[0]?.date}), Fehler: ${r.errors.length}`);
    expect(r.rows).toHaveLength(2);
    expect(r.errors).toHaveLength(0);
  });
});

describe("HOCH: Import kürzt lange Tage endgültig", () => {
  it("BUG: 16h ohne Von/Bis -> abgeleitet 08:00-23:59, hours wird von der Route verworfen", async () => {
    const r = parseTimesheetWorkbook(await wb([
      ["11.08.2026", "Di", 16, "Arbeitszeit", "", "", ""],
    ]));
    const row = r.rows[0];
    const effektiv = Number((((23 * 60 + 59) - 8 * 60 - row.pauseMin) / 60).toFixed(2));
    console.log(`  -> abgeleitet: ${row.von}-${row.bis}, Pause ${row.pauseMin} -> ${effektiv}h statt ${row.hours}h`);
    expect(row.bis).toBe("23:59");
    expect(effektiv).toBe(14.98);
  });
});
