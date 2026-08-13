import { describe, expect, it } from "vitest";
import {
  feriensaldo,
  kennzahlen,
  pensumAt,
  sollStundenTag,
  stundenAusEintrag,
  type Profil,
} from "./calc";

const testProfil: Profil = {
  wochenstunden: 40,
  pensum: 60,
  ferientage: 25,
  startDate: "2026-04-01",
  exitDate: null,
};

describe("Referenzwerte (Testprofil: 40h/60%/25 Ferientage, Start 01.04.2026, Stichtag 12.08.2026)", () => {
  it("Sollstunden pro Tag = 4.8h", () => {
    expect(sollStundenTag("2026-08-12", testProfil, [])).toBeCloseTo(4.8, 5);
  });

  it("Soll August bis 12.08. = 38.4h", () => {
    const result = kennzahlen({
      from: "2026-08-01",
      to: "2026-08-31",
      heute: "2026-08-12",
      eintraege: [],
      profil: testProfil,
      changes: [],
      payouts: [],
      kunden: [],
    });
    expect(result.soll).toBe(38.4);
  });

  it("Soll August gesamt = 100.8h", () => {
    const result = kennzahlen({
      from: "2026-08-01",
      to: "2026-08-31",
      heute: "2026-08-12",
      eintraege: [],
      profil: testProfil,
      changes: [],
      payouts: [],
      kunden: [],
    });
    expect(result.sollGesamt).toBe(100.8);
  });

  it("Ferienanspruch 2026 = 18.8", () => {
    const result = feriensaldo({
      jahr: 2026,
      heute: "2026-08-12",
      profil: testProfil,
      changes: [],
      eintraege: [],
    });
    expect(result.anspruch).toBe(18.8);
  });
});

describe("stundenAusEintrag", () => {
  it("Schicht über Mitternacht (22:00–06:00, 30min Pause) = 7.5h", () => {
    const stunden = stundenAusEintrag(
      { typ: "arbeit", von: "22:00", bis: "06:00", pauseMin: 30 },
      4.8
    );
    expect(stunden).toBeCloseTo(7.5, 5);
  });

  it("Absenz ohne gesetzte hours erbt Sollstunden des Tages", () => {
    const stunden = stundenAusEintrag({ typ: "krank" }, 4.8);
    expect(stunden).toBe(4.8);
  });

  it("Absenz mit gesetzten hours nutzt diese statt Sollstunden", () => {
    const stunden = stundenAusEintrag({ typ: "krank", hours: 2 }, 4.8);
    expect(stunden).toBe(2);
  });

  it("unbezahlt ist immer 0, auch wenn hours gesetzt ist", () => {
    const stunden = stundenAusEintrag({ typ: "unbezahlt", hours: 8 }, 4.8);
    expect(stunden).toBe(0);
  });

  it("arbeit ohne von/bis fällt auf hours zurück", () => {
    const stunden = stundenAusEintrag({ typ: "arbeit", hours: 6.5 }, 4.8);
    expect(stunden).toBe(6.5);
  });
});

describe("Pensumwechsel mitten im Monat", () => {
  const profil: Profil = {
    wochenstunden: 40,
    pensum: 100,
    ferientage: 25,
    startDate: "2026-01-01",
    exitDate: null,
  };
  const changes = [{ effectiveFrom: "2026-08-15", pensum: 50, wochenstunden: 40 }];

  it("pensumAt liefert vor effectiveFrom die Profilwerte", () => {
    expect(pensumAt("2026-08-14", profil, changes)).toEqual({ pensum: 100, wochenstunden: 40 });
  });

  it("pensumAt liefert ab effectiveFrom die neuen Werte", () => {
    expect(pensumAt("2026-08-15", profil, changes)).toEqual({ pensum: 50, wochenstunden: 40 });
  });

  it("Soll splittet korrekt am effectiveFrom (8h vor, 4h nach Wechsel in derselben Woche)", () => {
    // Woche 10.–14.8.2026 (Mo–Fr) vor dem Wechsel: 5 × 8h = 40h
    expect(sollStundenTag("2026-08-10", profil, changes)).toBeCloseTo(8, 5);
    expect(sollStundenTag("2026-08-14", profil, changes)).toBeCloseTo(8, 5);
    // Ab 15.8. (Samstag, zählt nicht) — nächster Wochentag 17.8. mit 50%: 4h
    expect(sollStundenTag("2026-08-17", profil, changes)).toBeCloseTo(4, 5);
  });
});

describe("Zeitraum komplett vor startDate", () => {
  it("Soll ist 0", () => {
    const profil: Profil = { wochenstunden: 40, pensum: 100, ferientage: 25, startDate: "2026-04-01", exitDate: null };
    const result = kennzahlen({
      from: "2026-01-05",
      to: "2026-01-09",
      heute: "2026-08-12",
      eintraege: [],
      profil,
      changes: [],
      payouts: [],
      kunden: [],
    });
    expect(result.soll).toBe(0);
    expect(result.sollGesamt).toBe(0);
  });
});

describe("exitDate (Austritt, MIGRATION.md Punkt 4d)", () => {
  // 2026-08-14 ist ein Freitag, 2026-08-17 der nächste Werktag (Montag).
  const profil: Profil = { wochenstunden: 40, pensum: 100, ferientage: 25, startDate: "2026-01-01", exitDate: "2026-08-14" };

  it("exitDate selbst zählt noch als normaler Arbeitstag (letzter Arbeitstag)", () => {
    expect(sollStundenTag("2026-08-14", profil, [])).toBeCloseTo(8, 5);
  });

  it("der erste Werktag nach exitDate hat Tagessoll 0", () => {
    expect(sollStundenTag("2026-08-17", profil, [])).toBe(0);
  });

  it("Zeitraum komplett nach exitDate: soll und sollGesamt sind 0", () => {
    const result = kennzahlen({
      from: "2026-08-17",
      to: "2026-08-21",
      heute: "2026-08-19",
      eintraege: [],
      profil,
      changes: [],
      payouts: [],
      kunden: [],
    });
    expect(result.soll).toBe(0);
    expect(result.sollGesamt).toBe(0);
  });

  it("Zeitraum umspannt exitDate: nur Tage bis und mit exitDate zählen ins Soll", () => {
    // Woche 10.–14.8.2026 (Mo–Fr): nur Mo–Fr bis inkl. 14.8. zählen = 5 Tage × 8h = 40h.
    // 17.–21.8. (nächste Woche, komplett nach exitDate) trägt nichts bei.
    const result = kennzahlen({
      from: "2026-08-10",
      to: "2026-08-21",
      heute: "2026-08-21",
      eintraege: [],
      profil,
      changes: [],
      payouts: [],
      kunden: [],
    });
    expect(result.soll).toBe(40);
    expect(result.sollGesamt).toBe(40);
  });

  it("ohne exitDate (null) bleibt das Verhalten unverändert", () => {
    const profilOhneExit: Profil = { ...profil, exitDate: null };
    expect(sollStundenTag("2026-08-17", profilOhneExit, [])).toBeCloseTo(8, 5);
  });
});

describe("Zeitraum komplett in der Zukunft", () => {
  it("soll = 0, sollGesamt > 0", () => {
    const profil: Profil = { wochenstunden: 40, pensum: 100, ferientage: 25, startDate: "2026-01-01", exitDate: null };
    const result = kennzahlen({
      from: "2026-09-01",
      to: "2026-09-30",
      heute: "2026-08-12",
      eintraege: [],
      profil,
      changes: [],
      payouts: [],
      kunden: [],
    });
    expect(result.soll).toBe(0);
    expect(result.sollGesamt).toBeGreaterThan(0);
  });
});

describe("verrechnungsgrad", () => {
  it("bei ist == 0 ist 0, kein NaN", () => {
    const profil: Profil = { wochenstunden: 40, pensum: 100, ferientage: 25, startDate: "2026-01-01", exitDate: null };
    const result = kennzahlen({
      from: "2026-08-01",
      to: "2026-08-02",
      heute: "2026-01-01",
      eintraege: [],
      profil,
      changes: [],
      payouts: [],
      kunden: [],
    });
    expect(result.ist).toBe(0);
    expect(result.verrechnungsgrad).toBe(0);
    expect(Number.isNaN(result.verrechnungsgrad)).toBe(false);
  });

  it("berechnet sich aus billable Kundenstunden / ist", () => {
    const profil: Profil = { wochenstunden: 40, pensum: 100, ferientage: 25, startDate: "2026-01-01", exitDate: null };
    const result = kennzahlen({
      from: "2026-08-10",
      to: "2026-08-11",
      heute: "2026-08-12",
      eintraege: [
        { date: "2026-08-10", typ: "arbeit", von: "08:00", bis: "16:00", pauseMin: 0, customerId: "billable" },
        { date: "2026-08-11", typ: "arbeit", von: "08:00", bis: "16:00", pauseMin: 0, customerId: "nonbillable" },
      ],
      profil,
      changes: [],
      payouts: [],
      kunden: [
        { id: "billable", billable: true },
        { id: "nonbillable", billable: false },
      ],
    });
    expect(result.ist).toBe(16);
    expect(result.kundenstunden).toBe(8);
    expect(result.verrechnungsgrad).toBe(50);
  });
});

describe("ueberzeit berücksichtigt OvertimePayouts", () => {
  it("zieht Auszahlungen im Zeitraum ab", () => {
    const profil: Profil = { wochenstunden: 40, pensum: 100, ferientage: 25, startDate: "2026-01-01", exitDate: null };
    const result = kennzahlen({
      from: "2026-08-10",
      to: "2026-08-11",
      heute: "2026-08-12",
      eintraege: [
        { date: "2026-08-10", typ: "arbeit", von: "08:00", bis: "18:00", pauseMin: 0 },
        { date: "2026-08-11", typ: "arbeit", von: "08:00", bis: "18:00", pauseMin: 0 },
      ],
      profil,
      changes: [],
      payouts: [{ date: "2026-08-11", hours: 3 }],
      kunden: [],
    });
    // ist = 20h, soll = 16h (2 Tage × 8h), Auszahlung 3h → ueberzeit = 20 - 16 - 3 = 1
    expect(result.ist).toBe(20);
    expect(result.soll).toBe(16);
    expect(result.ueberzeit).toBe(1);
  });
});

describe("feriensaldo", () => {
  const profil: Profil = { wochenstunden: 40, pensum: 100, ferientage: 25, startDate: "2026-01-01", exitDate: null };

  it("bezogen zählt Ferien bis heute, geplant danach — in Tagen, nicht Stunden", () => {
    // Tagessoll bei 40h/100% = 8h/Tag → ein Ganztages-Eintrag mit 8h = 1 Tag
    const result = feriensaldo({
      jahr: 2026,
      heute: "2026-08-12",
      profil,
      changes: [],
      eintraege: [
        { date: "2026-08-10", typ: "ferien", hours: 8 },
        { date: "2026-09-01", typ: "ferien", hours: 8 },
      ],
    });
    expect(result.bezogen).toBe(1);
    expect(result.geplant).toBe(1);
    expect(result.offen).toBe(round1(result.anspruch - 2));
  });

  it("Halbtags-Ferieneintrag zählt anteilig (4h von 8h Tagessoll = 0.5 Tag)", () => {
    const result = feriensaldo({
      jahr: 2026,
      heute: "2026-08-12",
      profil,
      changes: [],
      eintraege: [{ date: "2026-08-10", typ: "ferien", hours: 4 }],
    });
    expect(result.bezogen).toBe(0.5);
  });

  it("Pensum geht nicht in den Anspruch ein", () => {
    const teilzeitProfil: Profil = { ...profil, pensum: 50 };
    const result = feriensaldo({ jahr: 2026, heute: "2026-08-12", profil: teilzeitProfil, changes: [], eintraege: [] });
    expect(result.anspruch).toBe(25);
  });

  function round1(n: number): number {
    return Math.round(n * 10) / 10;
  }
});

describe("feriensaldo mit Pensumswechsel", () => {
  // Ferien-Einträge tragen ihre Stunden explizit (so schreibt bulk-vacation sie,
  // pensum-korrekt gerundet). Nur dann schlägt der Bug zu: bei hours = null
  // erbt der Eintrag dasselbe falsche Tagessoll und der Fehler kürzt sich weg.
  // 14.08.2026 ist ein Freitag, 01.09.2026 ein Dienstag — beides Werktage,
  // sonst wäre das Tagessoll 0 und die Umrechnung stillschweigend 0 Tage.

  it("Reduktion 100% → 60% per 01.09.: beide Ferientage zählen je exakt 1.0", () => {
    const profil: Profil = { wochenstunden: 40, pensum: 100, ferientage: 25, startDate: "2026-01-01", exitDate: null };
    const result = feriensaldo({
      jahr: 2026,
      heute: "2026-12-31",
      profil,
      changes: [{ effectiveFrom: "2026-09-01", pensum: 60, wochenstunden: 40 }],
      eintraege: [
        { date: "2026-08-14", typ: "ferien", hours: 8 }, // Tagessoll 8h (100%)
        { date: "2026-09-01", typ: "ferien", hours: 4.8 }, // Tagessoll 4.8h (60%)
      ],
    });
    // Ohne durchgereichte changes: 4.8h / 8h = 0.6 → bezogen 1.6 statt 2
    expect(result.bezogen).toBe(2);
    expect(result.anspruch).toBe(25);
    expect(result.offen).toBe(23);
  });

  it("Erhöhung 60% → 100% per 01.09.: beide Ferientage zählen je exakt 1.0", () => {
    const profil: Profil = { wochenstunden: 40, pensum: 60, ferientage: 25, startDate: "2026-01-01", exitDate: null };
    const result = feriensaldo({
      jahr: 2026,
      heute: "2026-12-31",
      profil,
      changes: [{ effectiveFrom: "2026-09-01", pensum: 100, wochenstunden: 40 }],
      eintraege: [
        { date: "2026-08-14", typ: "ferien", hours: 4.8 }, // Tagessoll 4.8h (60%)
        { date: "2026-09-01", typ: "ferien", hours: 8 }, // Tagessoll 8h (100%)
      ],
    });
    // Ohne durchgereichte changes: 8h / 4.8h = 1.67 → bezogen 2.7 statt 2
    expect(result.bezogen).toBe(2);
    expect(result.offen).toBe(23);
  });

  it("geplant (nach heute) wird ebenfalls über das korrekte Tagessoll gerechnet", () => {
    const profil: Profil = { wochenstunden: 40, pensum: 100, ferientage: 25, startDate: "2026-01-01", exitDate: null };
    const result = feriensaldo({
      jahr: 2026,
      heute: "2026-08-12",
      profil,
      changes: [{ effectiveFrom: "2026-09-01", pensum: 60, wochenstunden: 40 }],
      eintraege: [{ date: "2026-09-01", typ: "ferien", hours: 4.8 }],
    });
    expect(result.geplant).toBe(1);
    expect(result.bezogen).toBe(0);
  });
});
