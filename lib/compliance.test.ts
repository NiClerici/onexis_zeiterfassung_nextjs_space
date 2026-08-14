import { describe, expect, it } from "vitest";
import { pruefeCompliance } from "./compliance";
import type { EintragMitDatum } from "./calc";

function arbeit(date: string, von: string, bis: string, pauseMin: number): EintragMitDatum {
  return { date, typ: "arbeit", von, bis, pauseMin };
}

describe("pruefeCompliance — Pausenregel (Art. 15 ArG)", () => {
  it("meldet zu kurze Pause bei über 5.5h Arbeit (Schwelle 15 Min.)", () => {
    // 08:00-14:10 mit 10 Min. Pause = 6h Arbeit, unter 15 Min. Pflichtpause.
    const violations = pruefeCompliance([arbeit("2026-08-10", "08:00", "14:10", 10)], []);
    expect(violations.some((v) => v.type === "pause_zu_kurz")).toBe(true);
  });

  it("meldet zu kurze Pause bei über 7h Arbeit (Schwelle 30 Min.)", () => {
    // 08:00-16:20 mit 20 Min. Pause = 8h Arbeit, unter 30 Min. Pflichtpause.
    const violations = pruefeCompliance([arbeit("2026-08-10", "08:00", "16:20", 20)], []);
    expect(violations.some((v) => v.type === "pause_zu_kurz")).toBe(true);
  });

  it("meldet zu kurze Pause bei über 9h Arbeit (Schwelle 60 Min.)", () => {
    // 08:00-18:45 mit 45 Min. Pause = 10h Arbeit, unter 60 Min. Pflichtpause.
    const violations = pruefeCompliance([arbeit("2026-08-10", "08:00", "18:45", 45)], []);
    expect(violations.some((v) => v.type === "pause_zu_kurz")).toBe(true);
  });

  it("meldet KEINE Verletzung, wenn die Pause der höchsten erreichten Schwelle genügt", () => {
    // 10h Arbeit, 60 Min. Pause — erfüllt die 60-Min.-Schwelle exakt.
    const violations = pruefeCompliance([arbeit("2026-08-10", "08:00", "19:00", 60)], []);
    expect(violations.some((v) => v.type === "pause_zu_kurz")).toBe(false);
  });

  it("unter 5.5h Arbeit ist keine Pause vorgeschrieben", () => {
    const violations = pruefeCompliance([arbeit("2026-08-10", "08:00", "13:00", 0)], []);
    expect(violations.some((v) => v.type === "pause_zu_kurz")).toBe(false);
  });
});

describe("pruefeCompliance — Tageshöchstarbeitszeit", () => {
  it("meldet Überschreitung bei mehr als 12.5h Arbeit am Tag", () => {
    const violations = pruefeCompliance([arbeit("2026-08-10", "06:00", "19:30", 60)], []); // 12.5h netto
    // 06:00-19:30 = 13.5h brutto - 1h Pause = 12.5h netto -> genau an der Grenze, keine Überschreitung
    expect(violations.some((v) => v.type === "tagesarbeitszeit_ueberschritten")).toBe(false);
    const violations2 = pruefeCompliance([arbeit("2026-08-10", "06:00", "20:00", 60)], []); // 13h netto
    expect(violations2.some((v) => v.type === "tagesarbeitszeit_ueberschritten")).toBe(true);
  });
});

describe("pruefeCompliance — Ruhezeit zum Vortag (Art. 15a ArG)", () => {
  it("meldet zu kurze Ruhezeit (unter 11h zwischen gestrigem Ende und heutigem Start)", () => {
    const vortag = [arbeit("2026-08-09", "12:00", "23:00", 30)];
    const heute = [arbeit("2026-08-10", "07:00", "12:00", 0)]; // nur 8h Ruhezeit
    const violations = pruefeCompliance(heute, vortag);
    expect(violations.some((v) => v.type === "ruhezeit_zu_kurz")).toBe(true);
  });

  it("meldet KEINE Verletzung bei ausreichender Ruhezeit (≥11h)", () => {
    const vortag = [arbeit("2026-08-09", "08:00", "17:00", 30)];
    const heute = [arbeit("2026-08-10", "08:00", "17:00", 30)]; // 15h Ruhezeit
    const violations = pruefeCompliance(heute, vortag);
    expect(violations.some((v) => v.type === "ruhezeit_zu_kurz")).toBe(false);
  });

  it("wird nicht geprüft, wenn am Vortag keine Arbeitseinträge vorliegen (kein Crash, keine Verletzung)", () => {
    const violations = pruefeCompliance([arbeit("2026-08-10", "08:00", "12:00", 0)], []);
    expect(violations.some((v) => v.type === "ruhezeit_zu_kurz")).toBe(false);
  });

  it("berücksichtigt eine Nachtschicht des Vortags über Mitternacht korrekt", () => {
    // Vortag 22:00-06:00 (endet effektiv am heutigen Kalendertag um 06:00).
    const vortag = [arbeit("2026-08-09", "22:00", "06:00", 30)];
    const heute = [arbeit("2026-08-10", "16:00", "20:00", 0)]; // 10h Ruhezeit ab 06:00
    const violations = pruefeCompliance(heute, vortag);
    expect(violations.some((v) => v.type === "ruhezeit_zu_kurz")).toBe(true);
  });
});

describe("pruefeCompliance — Sonntags- und Nachtarbeit", () => {
  it("meldet Sonntagsarbeit an einem Sonntag mit Arbeitseintrag", () => {
    // 2026-08-16 ist ein Sonntag.
    const violations = pruefeCompliance([arbeit("2026-08-16", "09:00", "12:00", 0)], []);
    expect(violations.some((v) => v.type === "sonntagsarbeit")).toBe(true);
  });

  it("meldet KEINE Sonntagsarbeit an einem Werktag", () => {
    const violations = pruefeCompliance([arbeit("2026-08-10", "09:00", "12:00", 0)], []); // Montag
    expect(violations.some((v) => v.type === "sonntagsarbeit")).toBe(false);
  });

  it("meldet Nachtarbeit bei einer Schicht, die 23:00–06:00 überschneidet", () => {
    const violations = pruefeCompliance([arbeit("2026-08-10", "22:00", "02:00", 0)], []);
    expect(violations.some((v) => v.type === "nachtarbeit")).toBe(true);
  });

  it("meldet KEINE Nachtarbeit bei einer Tagschicht", () => {
    const violations = pruefeCompliance([arbeit("2026-08-10", "08:00", "17:00", 30)], []);
    expect(violations.some((v) => v.type === "nachtarbeit")).toBe(false);
  });
});

describe("pruefeCompliance — Randfälle", () => {
  it("liefert eine leere Liste ohne Einträge", () => {
    expect(pruefeCompliance([], [])).toEqual([]);
  });

  it("Absenzen (krank/ferien) zählen nicht als Arbeitszeit für Pause/Höchstgrenze/Nachtarbeit", () => {
    const violations = pruefeCompliance([{ date: "2026-08-10", typ: "krank", hours: 13 }], []);
    expect(violations).toEqual([]);
  });

  it("mehrere Verstösse gleichzeitig werden alle gemeldet", () => {
    // Sonntag (2026-08-16) mit 8h Arbeit und nur 5 Min. Pause.
    const violations = pruefeCompliance([arbeit("2026-08-16", "08:00", "16:05", 5)], []);
    expect(violations.some((v) => v.type === "sonntagsarbeit")).toBe(true);
    expect(violations.some((v) => v.type === "pause_zu_kurz")).toBe(true);
    expect(violations.length).toBeGreaterThanOrEqual(2);
  });
});
