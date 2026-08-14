import { describe, expect, it } from "vitest";
import {
  feriensaldo,
  kennzahlen,
  pensumAt,
  sollStundenTag,
  stundenAusEintrag,
  wochenUebersicht,
  type Profil,
  type HolidayInput,
} from "./calc";

const testProfil: Profil = {
  wochenstunden: 40,
  pensum: 60,
  ferientage: 25,
  startDate: "2026-04-01",
  exitDate: null,
  maxWeeklyHours: 45,
};

describe("Referenzwerte (Testprofil: 40h/60%/25 Ferientage, Start 01.04.2026, Stichtag 12.08.2026)", () => {
  it("Sollstunden pro Tag = 4.8h", () => {
    expect(sollStundenTag("2026-08-12", testProfil, [], [])).toBeCloseTo(4.8, 5);
  });

  it("Soll August bis 12.08. = 38.4h", () => {
    const result = kennzahlen({
      from: "2026-08-01",
      to: "2026-08-31",
      heute: "2026-08-12",
      eintraege: [],
      profil: testProfil,
      changes: [],
      holidays: [],
      payouts: [],
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
      holidays: [],
      payouts: [],
    });
    expect(result.sollGesamt).toBe(100.8);
  });

  it("Ferienanspruch 2026 = 18.8", () => {
    const result = feriensaldo({
      jahr: 2026,
      heute: "2026-08-12",
      profil: testProfil,
      changes: [],
      holidays: [],
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
    maxWeeklyHours: 45,
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
    expect(sollStundenTag("2026-08-10", profil, changes, [])).toBeCloseTo(8, 5);
    expect(sollStundenTag("2026-08-14", profil, changes, [])).toBeCloseTo(8, 5);
    // Ab 15.8. (Samstag, zählt nicht) — nächster Wochentag 17.8. mit 50%: 4h
    expect(sollStundenTag("2026-08-17", profil, changes, [])).toBeCloseTo(4, 5);
  });
});

describe("Zeitraum komplett vor startDate", () => {
  it("Soll ist 0", () => {
    const profil: Profil = { wochenstunden: 40, pensum: 100, ferientage: 25, startDate: "2026-04-01", exitDate: null, maxWeeklyHours: 45 };
    const result = kennzahlen({
      from: "2026-01-05",
      to: "2026-01-09",
      heute: "2026-08-12",
      eintraege: [],
      profil,
      changes: [],
      holidays: [],
      payouts: [],
    });
    expect(result.soll).toBe(0);
    expect(result.sollGesamt).toBe(0);
  });
});

describe("exitDate (Austritt, MIGRATION.md Punkt 4d)", () => {
  // 2026-08-14 ist ein Freitag, 2026-08-17 der nächste Werktag (Montag).
  const profil: Profil = { wochenstunden: 40, pensum: 100, ferientage: 25, startDate: "2026-01-01", exitDate: "2026-08-14", maxWeeklyHours: 45 };

  it("exitDate selbst zählt noch als normaler Arbeitstag (letzter Arbeitstag)", () => {
    expect(sollStundenTag("2026-08-14", profil, [], [])).toBeCloseTo(8, 5);
  });

  it("der erste Werktag nach exitDate hat Tagessoll 0", () => {
    expect(sollStundenTag("2026-08-17", profil, [], [])).toBe(0);
  });

  it("Zeitraum komplett nach exitDate: soll und sollGesamt sind 0", () => {
    const result = kennzahlen({
      from: "2026-08-17",
      to: "2026-08-21",
      heute: "2026-08-19",
      eintraege: [],
      profil,
      changes: [],
      holidays: [],
      payouts: [],
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
      holidays: [],
      payouts: [],
    });
    expect(result.soll).toBe(40);
    expect(result.sollGesamt).toBe(40);
  });

  it("ohne exitDate (null) bleibt das Verhalten unverändert", () => {
    const profilOhneExit: Profil = { ...profil, exitDate: null, maxWeeklyHours: 45 };
    expect(sollStundenTag("2026-08-17", profilOhneExit, [], [])).toBeCloseTo(8, 5);
  });
});

describe("Zeitraum komplett in der Zukunft", () => {
  it("soll = 0, sollGesamt > 0", () => {
    const profil: Profil = { wochenstunden: 40, pensum: 100, ferientage: 25, startDate: "2026-01-01", exitDate: null, maxWeeklyHours: 45 };
    const result = kennzahlen({
      from: "2026-09-01",
      to: "2026-09-30",
      heute: "2026-08-12",
      eintraege: [],
      profil,
      changes: [],
      holidays: [],
      payouts: [],
    });
    expect(result.soll).toBe(0);
    expect(result.sollGesamt).toBeGreaterThan(0);
  });
});

describe("verrechnungsgrad", () => {
  it("bei ist == 0 ist 0, kein NaN", () => {
    const profil: Profil = { wochenstunden: 40, pensum: 100, ferientage: 25, startDate: "2026-01-01", exitDate: null, maxWeeklyHours: 45 };
    const result = kennzahlen({
      from: "2026-08-01",
      to: "2026-08-02",
      heute: "2026-01-01",
      eintraege: [],
      profil,
      changes: [],
      holidays: [],
      payouts: [],
    });
    expect(result.ist).toBe(0);
    expect(result.verrechnungsgrad).toBe(0);
    expect(Number.isNaN(result.verrechnungsgrad)).toBe(false);
  });

  it("berechnet sich aus billable Kundenstunden / ist", () => {
    const profil: Profil = { wochenstunden: 40, pensum: 100, ferientage: 25, startDate: "2026-01-01", exitDate: null, maxWeeklyHours: 45 };
    const result = kennzahlen({
      from: "2026-08-10",
      to: "2026-08-11",
      heute: "2026-08-12",
      eintraege: [
        { date: "2026-08-10", typ: "arbeit", von: "08:00", bis: "16:00", pauseMin: 0, customerId: "billable", billable: true },
        { date: "2026-08-11", typ: "arbeit", von: "08:00", bis: "16:00", pauseMin: 0, customerId: "nonbillable", billable: false },
      ],
      profil,
      changes: [],
      holidays: [],
      payouts: [],
    });
    expect(result.ist).toBe(16);
    expect(result.kundenstunden).toBe(8);
    expect(result.verrechnungsgrad).toBe(50);
  });
});

describe("ueberstunden berücksichtigt OvertimePayouts (Art. 321c OR)", () => {
  it("zieht Auszahlungen im Zeitraum ab", () => {
    const profil: Profil = { wochenstunden: 40, pensum: 100, ferientage: 25, startDate: "2026-01-01", exitDate: null, maxWeeklyHours: 45 };
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
      holidays: [],
      payouts: [{ date: "2026-08-11", hours: 3 }],
    });
    // ist = 20h, soll = 16h (2 Tage × 8h), Auszahlung 3h → ueberstunden = 20 - 16 - 3 = 1
    expect(result.ist).toBe(20);
    expect(result.soll).toBe(16);
    expect(result.ueberstunden).toBe(1);
    // Woche 10.–11.8. bleibt mit 20h weit unter dem gesetzlichen Limit von 45h → keine Überzeit.
    expect(result.ueberzeit).toBe(0);
  });
});

describe("ueberzeit: wöchentliches gesetzliches Limit (Art. 12/13 ArG)", () => {
  const profil: Profil = { wochenstunden: 40, pensum: 100, ferientage: 25, startDate: "2026-01-01", exitDate: null, maxWeeklyHours: 45 };

  it("Woche über dem Limit erzeugt Überzeit in Höhe des Überschusses", () => {
    // Woche 10.–14.8.2026 (Mo–Fr), 5 × 10h = 50h arbeit → 5h über dem Limit von 45h.
    const result = kennzahlen({
      from: "2026-08-10",
      to: "2026-08-14",
      heute: "2026-08-14",
      eintraege: [
        { date: "2026-08-10", typ: "arbeit", von: "08:00", bis: "18:00", pauseMin: 0 },
        { date: "2026-08-11", typ: "arbeit", von: "08:00", bis: "18:00", pauseMin: 0 },
        { date: "2026-08-12", typ: "arbeit", von: "08:00", bis: "18:00", pauseMin: 0 },
        { date: "2026-08-13", typ: "arbeit", von: "08:00", bis: "18:00", pauseMin: 0 },
        { date: "2026-08-14", typ: "arbeit", von: "08:00", bis: "18:00", pauseMin: 0 },
      ],
      profil,
      changes: [],
      holidays: [],
      payouts: [],
    });
    expect(result.ueberzeit).toBe(5);
  });

  it("Woche unter dem Limit erzeugt keine Überzeit", () => {
    // Woche 10.–14.8.2026, 5 × 8h = 40h arbeit, unter dem Limit von 45h.
    const result = kennzahlen({
      from: "2026-08-10",
      to: "2026-08-14",
      heute: "2026-08-14",
      eintraege: [
        { date: "2026-08-10", typ: "arbeit", von: "08:00", bis: "16:00", pauseMin: 0 },
        { date: "2026-08-11", typ: "arbeit", von: "08:00", bis: "16:00", pauseMin: 0 },
        { date: "2026-08-12", typ: "arbeit", von: "08:00", bis: "16:00", pauseMin: 0 },
        { date: "2026-08-13", typ: "arbeit", von: "08:00", bis: "16:00", pauseMin: 0 },
        { date: "2026-08-14", typ: "arbeit", von: "08:00", bis: "16:00", pauseMin: 0 },
      ],
      profil,
      changes: [],
      holidays: [],
      payouts: [],
    });
    expect(result.ueberzeit).toBe(0);
  });

  it("Absenzen zählen nicht zur wöchentlichen Überzeit", () => {
    // Woche 10.–14.8.2026: 4 Tage à 10h arbeit (40h) + 1 Krankheitstag mit 10h hours.
    // Nur arbeit zählt zum gesetzlichen Limit → 40h, unter 45h → keine Überzeit,
    // obwohl "ist" (inkl. Absenz) über dem Limit läge.
    const result = kennzahlen({
      from: "2026-08-10",
      to: "2026-08-14",
      heute: "2026-08-14",
      eintraege: [
        { date: "2026-08-10", typ: "arbeit", von: "08:00", bis: "18:00", pauseMin: 0 },
        { date: "2026-08-11", typ: "arbeit", von: "08:00", bis: "18:00", pauseMin: 0 },
        { date: "2026-08-12", typ: "arbeit", von: "08:00", bis: "18:00", pauseMin: 0 },
        { date: "2026-08-13", typ: "arbeit", von: "08:00", bis: "18:00", pauseMin: 0 },
        { date: "2026-08-14", typ: "krank", hours: 10 },
      ],
      profil,
      changes: [],
      holidays: [],
      payouts: [],
    });
    expect(result.ueberzeit).toBe(0);
  });

  it("mehrere Wochen: nur die überschreitende Woche trägt zur Überzeit bei", () => {
    // Woche 1 (10.–14.8.): 5 × 10h = 50h → 5h Überzeit.
    // Woche 2 (17.–18.8.): 2 × 8h = 16h → 0h Überzeit.
    // Summe über den Zeitraum: 5h.
    const result = kennzahlen({
      from: "2026-08-10",
      to: "2026-08-18",
      heute: "2026-08-18",
      eintraege: [
        { date: "2026-08-10", typ: "arbeit", von: "08:00", bis: "18:00", pauseMin: 0 },
        { date: "2026-08-11", typ: "arbeit", von: "08:00", bis: "18:00", pauseMin: 0 },
        { date: "2026-08-12", typ: "arbeit", von: "08:00", bis: "18:00", pauseMin: 0 },
        { date: "2026-08-13", typ: "arbeit", von: "08:00", bis: "18:00", pauseMin: 0 },
        { date: "2026-08-14", typ: "arbeit", von: "08:00", bis: "18:00", pauseMin: 0 },
        { date: "2026-08-17", typ: "arbeit", von: "08:00", bis: "16:00", pauseMin: 0 },
        { date: "2026-08-18", typ: "arbeit", von: "08:00", bis: "16:00", pauseMin: 0 },
      ],
      profil,
      changes: [],
      holidays: [],
      payouts: [],
    });
    expect(result.ueberzeit).toBe(5);
  });
});

describe("feriensaldo", () => {
  const profil: Profil = { wochenstunden: 40, pensum: 100, ferientage: 25, startDate: "2026-01-01", exitDate: null, maxWeeklyHours: 45 };

  it("bezogen zählt Ferien bis heute, geplant danach — in Tagen, nicht Stunden", () => {
    // Tagessoll bei 40h/100% = 8h/Tag → ein Ganztages-Eintrag mit 8h = 1 Tag
    const result = feriensaldo({
      jahr: 2026,
      heute: "2026-08-12",
      profil,
      changes: [],
      holidays: [],
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
      holidays: [],
      eintraege: [{ date: "2026-08-10", typ: "ferien", hours: 4 }],
    });
    expect(result.bezogen).toBe(0.5);
  });

  it("Pensum geht nicht in den Anspruch ein", () => {
    const teilzeitProfil: Profil = { ...profil, pensum: 50 };
    const result = feriensaldo({ jahr: 2026, heute: "2026-08-12", profil: teilzeitProfil, changes: [], holidays: [], eintraege: [] });
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
    const profil: Profil = { wochenstunden: 40, pensum: 100, ferientage: 25, startDate: "2026-01-01", exitDate: null, maxWeeklyHours: 45 };
    const result = feriensaldo({
      jahr: 2026,
      heute: "2026-12-31",
      profil,
      changes: [{ effectiveFrom: "2026-09-01", pensum: 60, wochenstunden: 40 }],
      holidays: [],
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
    const profil: Profil = { wochenstunden: 40, pensum: 60, ferientage: 25, startDate: "2026-01-01", exitDate: null, maxWeeklyHours: 45 };
    const result = feriensaldo({
      jahr: 2026,
      heute: "2026-12-31",
      profil,
      changes: [{ effectiveFrom: "2026-09-01", pensum: 100, wochenstunden: 40 }],
      holidays: [],
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
    const profil: Profil = { wochenstunden: 40, pensum: 100, ferientage: 25, startDate: "2026-01-01", exitDate: null, maxWeeklyHours: 45 };
    const result = feriensaldo({
      jahr: 2026,
      heute: "2026-08-12",
      profil,
      changes: [{ effectiveFrom: "2026-09-01", pensum: 60, wochenstunden: 40 }],
      holidays: [],
      eintraege: [{ date: "2026-09-01", typ: "ferien", hours: 4.8 }],
    });
    expect(result.geplant).toBe(1);
    expect(result.bezogen).toBe(0);
  });
});

describe("Feiertage (MIGRATION.md Punkt 6c)", () => {
  const profil: Profil = { wochenstunden: 40, pensum: 100, ferientage: 25, startDate: "2026-01-01", exitDate: null, maxWeeklyHours: 45 };

  it("sollStundenTag gibt an Karfreitag (beweglich, 2026-04-03) 0 zurück", () => {
    const holidays: HolidayInput[] = [{ date: "2026-04-03", halfDay: false }];
    expect(sollStundenTag("2026-04-03", profil, [], holidays)).toBe(0);
  });

  it("sollStundenTag gibt an Ostermontag (beweglich, 2026-04-06) 0 zurück", () => {
    const holidays: HolidayInput[] = [{ date: "2026-04-06", halfDay: false }];
    expect(sollStundenTag("2026-04-06", profil, [], holidays)).toBe(0);
  });

  it("sollStundenTag gibt an einem Halbtags-Feiertag die Hälfte des Tagessolls zurück", () => {
    const holidays: HolidayInput[] = [{ date: "2026-04-03", halfDay: true }];
    expect(sollStundenTag("2026-04-03", profil, [], holidays)).toBeCloseTo(4, 5);
  });

  it("ein kantonaler Feiertag (Kantonsfeiertag Jura, 2026-06-23) reduziert das Tagessoll ebenso", () => {
    const holidays: HolidayInput[] = [{ date: "2026-06-23", halfDay: false }];
    expect(sollStundenTag("2026-06-23", profil, [], holidays)).toBe(0);
    // An einem normalen Werktag ohne Feiertag bleibt das Soll unverändert.
    expect(sollStundenTag("2026-06-24", profil, [], holidays)).toBeCloseTo(8, 5);
  });

  it("ein Feiertag an einem Wochenende ändert nichts (Tagessoll ist dort ohnehin 0)", () => {
    // 2026-08-01 (Bundesfeier) ist ein Samstag.
    const holidays: HolidayInput[] = [{ date: "2026-08-01", halfDay: false }];
    expect(sollStundenTag("2026-08-01", profil, [], holidays)).toBe(0);
  });

  it("kennzahlen: soll reduziert sich in einer Woche mit zwei Feiertagen (Karfreitag + Ostermontag) korrekt", () => {
    // Woche 30.3.–6.4.2026 (Mo–Mo): Werktage sind Mo,Di,Mi,Do,Fr,Mo — davon
    // Karfreitag (3.4.) und Ostermontag (6.4.) Feiertage → nur 4 Tage à 8h zählen.
    const holidays: HolidayInput[] = [
      { date: "2026-04-03", halfDay: false }, // Karfreitag
      { date: "2026-04-06", halfDay: false }, // Ostermontag
    ];
    const result = kennzahlen({
      from: "2026-03-30",
      to: "2026-04-06",
      heute: "2026-04-06",
      eintraege: [],
      profil,
      changes: [],
      payouts: [],
      holidays,
    });
    expect(result.soll).toBe(32);
    expect(result.sollGesamt).toBe(32);
  });

  it("kennzahlen: ein Arbeitseintrag an einem als Feiertag markierten Tag zählt trotzdem als ist (keine automatische Streichung)", () => {
    // Wer an einem Feiertag dennoch arbeitet, soll das weiterhin als Ist-Stunden
    // sehen — sollStundenTag beeinflusst nur das Soll, nicht erfasste Einträge.
    const holidays: HolidayInput[] = [{ date: "2026-04-03", halfDay: false }];
    const result = kennzahlen({
      from: "2026-04-03",
      to: "2026-04-03",
      heute: "2026-04-03",
      eintraege: [{ date: "2026-04-03", typ: "arbeit", von: "08:00", bis: "12:00", pauseMin: 0 }],
      profil,
      changes: [],
      payouts: [],
      holidays,
    });
    expect(result.soll).toBe(0);
    expect(result.ist).toBe(4);
  });
});

// MIGRATION.md Punkt 7 — ArG-Kontrollexport braucht die wöchentliche
// Arbeitszeit und Überzeit separat je Woche, nicht nur als Summe.
describe("wochenUebersicht (MIGRATION.md Punkt 7)", () => {
  const profil: Profil = {
    wochenstunden: 40,
    pensum: 100,
    ferientage: 25,
    startDate: null,
    exitDate: null,
    maxWeeklyHours: 45,
  };

  it("liefert eine Woche mit korrekter Arbeitszeit und keiner Überzeit unter dem Limit", () => {
    // 2026-08-03 (Mo) – 2026-08-07 (Fr), 5×9h = 45h — genau am Limit.
    const eintraege = ["03", "04", "05", "06", "07"].map((d) => ({
      date: `2026-08-${d}`,
      typ: "arbeit" as const,
      von: "08:00",
      bis: "17:00",
      pauseMin: 0,
    }));
    const result = wochenUebersicht(eintraege, profil, "2026-08-03", "2026-08-07");
    expect(result).toHaveLength(1);
    expect(result[0].montag).toBe("2026-08-03");
    expect(result[0].arbeitsstunden).toBe(45);
    expect(result[0].ueberzeit).toBe(0);
  });

  it("weist Überzeit aus, sobald die Wochenarbeitszeit über maxWeeklyHours liegt", () => {
    // 5×10h = 50h, 5h über dem 45h-Limit.
    const eintraege = ["03", "04", "05", "06", "07"].map((d) => ({
      date: `2026-08-${d}`,
      typ: "arbeit" as const,
      von: "08:00",
      bis: "18:00",
      pauseMin: 0,
    }));
    const result = wochenUebersicht(eintraege, profil, "2026-08-03", "2026-08-07");
    expect(result[0].arbeitsstunden).toBe(50);
    expect(result[0].ueberzeit).toBe(5);
  });

  it("gruppiert mehrere Wochen getrennt und sortiert sie aufsteigend nach Montag", () => {
    const eintraege = [
      { date: "2026-08-10", typ: "arbeit" as const, von: "08:00", bis: "17:00", pauseMin: 0 }, // KW2
      { date: "2026-08-03", typ: "arbeit" as const, von: "08:00", bis: "17:00", pauseMin: 0 }, // KW1
    ];
    const result = wochenUebersicht(eintraege, profil, "2026-08-01", "2026-08-14");
    expect(result.map((w) => w.montag)).toEqual(["2026-08-03", "2026-08-10"]);
  });

  it("ignoriert Einträge ausserhalb von [from, to]", () => {
    const eintraege = [{ date: "2026-08-03", typ: "arbeit" as const, von: "08:00", bis: "17:00", pauseMin: 0 }];
    const result = wochenUebersicht(eintraege, profil, "2026-08-10", "2026-08-14");
    expect(result).toHaveLength(0);
  });

  it("zählt Absenzen nicht als Arbeitszeit", () => {
    const eintraege = [{ date: "2026-08-03", typ: "ferien" as const, hours: 8 }];
    const result = wochenUebersicht(eintraege, profil, "2026-08-03", "2026-08-07");
    expect(result).toHaveLength(0);
  });
});
