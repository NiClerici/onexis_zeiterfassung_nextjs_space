// V6: Verrechnungsgrad >100% und die "0 ist nicht speicherbar"-Regel.
import { describe, it, expect } from "vitest";
import { kennzahlen, type Profil } from "@/lib/calc";
import { combineCustomerHours } from "@/lib/customer-months";

const profil: Profil = { pensum: 100, wochenstunden: 42, startDate: "2020-01-01", exitDate: null, ferientage: 25, maxWeeklyHours: 45 };

describe("MITTEL: Verrechnungsgrad kann über 100% steigen", () => {
  it("BUG: Teilmonat 10.-20.04. mit Kundenstunden des GANZEN Monats", () => {
    // 8 Arbeitstage à 8.4h im Teilzeitraum
    const eintraege = ["13","14","15","16","17","20"].map((d) => ({
      date: `2026-04-${d}`, typ: "arbeit" as const, von: "08:00", bis: "16:54", pauseMin: 30,
    }));
    const k = kennzahlen({
      from: "2026-04-10", to: "2026-04-20", heute: "2026-08-30",
      eintraege, profil, changes: [], payouts: [], holidays: [],
      kundenstunden: 102.8, // voller April, so wie billableHoursByUserAndMonth ihn liefert
    });
    console.log(`  -> Arbeitsstunden im Teilzeitraum: ${k.arbeitsstunden}h`);
    console.log(`  -> Kundenstunden (voller Monat):   ${k.kundenstunden}h`);
    console.log(`  -> Verrechnungsgrad:              ${k.verrechnungsgrad}%`);
    expect(k.verrechnungsgrad).toBeGreaterThan(100);
  });
});

describe("MITTEL: eine bewusste 0 wird von Legacy-Daten überschrieben", () => {
  it("BUG: CustomerMonth=0 verliert gegen Legacy-Stunden (Regel cm > 0 ? cm : legacy)", () => {
    // Nachbildung der Auflösung aus lib/customer-months.ts:161
    const aufloesen = (cm: number, legacy: number) => (cm > 0 ? cm : legacy);
    console.log(`  -> Admin traegt 0 ein, Legacy hat 96.75 -> wirksam: ${aufloesen(0, 96.75)}h`);
    expect(aufloesen(0, 96.75)).toBe(96.75);   // die Korrektur verpufft
    expect(aufloesen(102.8, 96.75)).toBe(102.8); // jeder andere Wert gewinnt korrekt
  });
  it("Zusammensetzung: fromEntries und fromMigration werden addiert", () => {
    expect(combineCustomerHours({ fromEntries: 8, fromMigration: 102.8 })).toBe(110.8);
  });
});
