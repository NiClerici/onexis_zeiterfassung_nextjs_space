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

// HARDENING.md A5 — bis hierher war die Pausenregel nur mit EINEM Eintrag pro
// Tag getestet. Reales Muster: vormittags ein Kunde, nachmittags ein anderer,
// zwei separate Einträge, Mittagspause als LÜCKE statt als pauseMin erfasst.
describe("pruefeCompliance — Pausenregel bei mehreren Einträgen am selben Tag (HARDENING.md A5)", () => {
  it("erkennt die Lücke zwischen zwei Einträgen als Pause (kein Fehlalarm)", () => {
    // 08:00–12:00 + 13:00–17:00 = 8h Arbeit, 60 Min. Lücke, je pauseMin 0.
    // Vorschrift bei 8h: 30 Min. — die Lücke deckt das ab.
    const violations = pruefeCompliance(
      [arbeit("2026-08-10", "08:00", "12:00", 0), arbeit("2026-08-10", "13:00", "17:00", 0)],
      []
    );
    expect(violations.some((v) => v.type === "pause_zu_kurz")).toBe(false);
  });

  it("meldet weiterhin, wenn die Lücke zu kurz ist", () => {
    // 08:00–12:00 + 12:10–16:10 = 8h Arbeit, nur 10 Min. Lücke, Vorschrift 30.
    const violations = pruefeCompliance(
      [arbeit("2026-08-10", "08:00", "12:00", 0), arbeit("2026-08-10", "12:10", "16:10", 0)],
      []
    );
    const v = violations.find((x) => x.type === "pause_zu_kurz");
    expect(v).toBeTruthy();
    expect(v!.message).toContain("10 Min. zwischen den Einträgen");
    expect(v!.message).toContain("= 10 Min.");
  });

  it("addiert erfasste pauseMin und Lücke zur effektiven Pause", () => {
    // 08:00–12:20 (20 Min. Pause) + 12:40–16:20 (0 Min.) = 8h Arbeit.
    // 20 Min. pauseMin + 20 Min. Lücke = 40 Min. ≥ 30 Min. Vorschrift.
    const violations = pruefeCompliance(
      [arbeit("2026-08-10", "08:00", "12:20", 20), arbeit("2026-08-10", "12:40", "16:20", 0)],
      []
    );
    expect(violations.some((v) => v.type === "pause_zu_kurz")).toBe(false);
  });

  it("die Reihenfolge der Einträge im Array spielt keine Rolle", () => {
    const nachmittagZuerst = pruefeCompliance(
      [arbeit("2026-08-10", "13:00", "17:00", 0), arbeit("2026-08-10", "08:00", "12:00", 0)],
      []
    );
    expect(nachmittagZuerst.some((v) => v.type === "pause_zu_kurz")).toBe(false);
  });

  it("überlappende Einträge erzeugen keine negative Pause", () => {
    // 08:00–17:00 und 10:00–12:00 überlappen vollständig. Netto-Arbeitszeit
    // 9h + 2h = 11h → Vorschrift 60 Min., erfasst 0 → Verstoss, aber die
    // Lücke darf die erfasste Pause nicht ins Negative ziehen.
    const violations = pruefeCompliance(
      [arbeit("2026-08-10", "08:00", "17:00", 0), arbeit("2026-08-10", "10:00", "12:00", 0)],
      []
    );
    const v = violations.find((x) => x.type === "pause_zu_kurz");
    expect(v).toBeTruthy();
    expect(v!.message).toContain("erfasst: 0 Min.");
    expect(v!.message).not.toContain("-");
  });

  it("drei Einträge: alle Lücken zählen zusammen", () => {
    // 08:00–10:00 + 10:20–12:00 + 12:40–15:00 = 2 + 1.67 + 2.33 = 6h Arbeit.
    // Vorschrift bei 6h: 15 Min. Lücken: 20 + 40 = 60 Min.
    const violations = pruefeCompliance(
      [
        arbeit("2026-08-10", "08:00", "10:00", 0),
        arbeit("2026-08-10", "10:20", "12:00", 0),
        arbeit("2026-08-10", "12:40", "15:00", 0),
      ],
      []
    );
    expect(violations.some((v) => v.type === "pause_zu_kurz")).toBe(false);
  });

  it("ein einzelner Eintrag verhält sich unverändert (keine Lücke, alte Meldung)", () => {
    const violations = pruefeCompliance([arbeit("2026-08-10", "08:00", "16:20", 20)], []);
    const v = violations.find((x) => x.type === "pause_zu_kurz");
    expect(v).toBeTruthy();
    expect(v!.message).toBe(
      "Bei 8.0h Arbeitszeit sind mindestens 30 Min. Pause vorgeschrieben (erfasst: 20 Min.)."
    );
  });

  it("eine Absenz zwischen zwei Arbeitseinträgen erzeugt keine Phantom-Lücke", () => {
    // Ein krank-Eintrag ohne von/bis liefert kein Intervall und darf die
    // Lückenberechnung nicht beeinflussen.
    const violations = pruefeCompliance(
      [
        arbeit("2026-08-10", "08:00", "12:00", 0),
        { date: "2026-08-10", typ: "krank", hours: 4 },
        arbeit("2026-08-10", "12:10", "16:10", 0),
      ],
      []
    );
    const v = violations.find((x) => x.type === "pause_zu_kurz");
    expect(v).toBeTruthy();
    expect(v!.message).toContain("10 Min. zwischen den Einträgen");
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
