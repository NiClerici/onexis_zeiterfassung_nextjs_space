import { describe, expect, it } from "vitest";
import {
  feriensaldo,
  kennzahlen,
  pensumAt,
  sollStundenTag,
  stundenAusEintrag,
  wochenUebersicht,
  teamKennzahlen,
  montagDerWoche,
  type Profil,
  type HolidayInput,
} from "./calc";
import { buildArbeitszeit } from "./arbeitszeit";

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
      kundenstunden: 0,
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
      kundenstunden: 0,
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

// Bugfix components/day-entry-dialog.tsx: der Umschalter "Von/Bis" ↔
// "Stunden direkt" muss beim Wechsel tatsächlich umrechnen, nicht nur das
// Anzeige-Flag setzen. Beide Richtungen laufen über stundenAusEintrag()
// bzw. buildArbeitszeit() — hier als reines Rechenpaar getestet, ohne
// Component-Test-Infrastruktur (im Projekt sonst nicht verwendet).
describe("Stunden-Umschalter im Tagesdialog — Hin-/Rückrechnung", () => {
  it("Von/Bis → Stunden übernimmt die tatsächlich eingetragene Zeit", () => {
    // 07:45–15:45, 45min Pause — genau das gemeldete Bug-Szenario.
    const stunden = stundenAusEintrag({ typ: "arbeit", von: "07:45", bis: "15:45", pauseMin: 45 }, 0);
    expect(stunden).toBeCloseTo(7.25, 5);
  });

  it("Stunden → Von/Bis normalisiert (Start 08:00, Pause nach Schwelle), Gesamtstunden bleiben erhalten", () => {
    // Rückrichtung ist bewusst NICHT symmetrisch zur Hinrichtung —
    // buildArbeitszeit setzt immer 08:00 als Start, nicht die ursprüngliche
    // Zeit. Der Test hält fest, was tatsächlich passiert, nicht eine
    // Symmetrie, die es nicht gibt.
    const { von, bis, pauseMin } = buildArbeitszeit(7.25);
    expect(von).toBe("08:00");
    expect(bis).toBe("15:45");
    expect(pauseMin).toBe(30);
    // Aber: die daraus resultierenden Gesamtstunden entsprechen wieder 7.25 —
    // nur die Aufteilung (Startzeit/Pausenlänge) hat sich geändert.
    const zurueck = stundenAusEintrag({ typ: "arbeit", von, bis, pauseMin }, 0);
    expect(zurueck).toBeCloseTo(7.25, 5);
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

// HARDENING.md A2 — bisher war nur EIN Wechsel pro Zeitraum getestet
// ("Pensumwechsel mitten im Monat" oben). Hier zwei Wechsel innerhalb
// desselben Auswertungszeitraums: jeder Tag muss den zu SEINEM Zeitpunkt
// gültigen Satz bekommen, nicht den letzten der Liste.
describe("Mehrfache Pensumsänderungen im selben Zeitraum (HARDENING.md A2)", () => {
  const profil: Profil = {
    wochenstunden: 40,
    pensum: 100,
    ferientage: 25,
    startDate: "2026-01-01",
    exitDate: null,
    maxWeeklyHours: 45,
  };
  // 100% (bis 30.04.) → 80% (ab 01.05.) → 60% (ab 01.06.), je zum Monatsersten.
  const changes = [
    { effectiveFrom: "2026-05-01", pensum: 80, wochenstunden: 40 },
    { effectiveFrom: "2026-06-01", pensum: 60, wochenstunden: 40 },
  ];
  // Werktage Q2 2026, unabhängig ausgezählt: April 22, Mai 21, Juni 22.
  // Soll = 22×8 + 21×6.4 + 22×4.8 = 176 + 134.4 + 105.6 = 416
  const Q2_SOLL = 416;

  it("sollStundenTag liefert je Monat den zum Zeitpunkt gültigen Satz, nicht den letzten", () => {
    expect(sollStundenTag("2026-04-15", profil, changes, [])).toBeCloseTo(8, 5);
    expect(sollStundenTag("2026-05-15", profil, changes, [])).toBeCloseTo(6.4, 5);
    expect(sollStundenTag("2026-06-15", profil, changes, [])).toBeCloseTo(4.8, 5);
  });

  it("Boundary: der effectiveFrom-Tag selbst zählt bereits mit dem neuen Satz", () => {
    // 30.04. (Do) noch 100%, 01.05. (Fr) bereits 80%
    expect(sollStundenTag("2026-04-30", profil, changes, [])).toBeCloseTo(8, 5);
    expect(sollStundenTag("2026-05-01", profil, changes, [])).toBeCloseTo(6.4, 5);
    // 29.05. (Fr) noch 80%, 01.06. (Mo) bereits 60%
    expect(sollStundenTag("2026-05-29", profil, changes, [])).toBeCloseTo(6.4, 5);
    expect(sollStundenTag("2026-06-01", profil, changes, [])).toBeCloseTo(4.8, 5);
    expect(pensumAt("2026-05-01", profil, changes)).toEqual({ pensum: 80, wochenstunden: 40 });
    expect(pensumAt("2026-06-01", profil, changes)).toEqual({ pensum: 60, wochenstunden: 40 });
  });

  it("kennzahlen summiert das Quartalssoll über beide Wechsel hinweg korrekt", () => {
    const result = kennzahlen({
      from: "2026-04-01",
      to: "2026-06-30",
      heute: "2026-07-01",
      eintraege: [],
      profil,
      changes,
      holidays: [],
      payouts: [],
      kundenstunden: 0,
    });
    expect(result.soll).toBe(Q2_SOLL);
    expect(result.sollGesamt).toBe(Q2_SOLL);
  });

  it("die Reihenfolge der Changes im Array ändert das Ergebnis nicht", () => {
    const unsortiert = [changes[1], changes[0]];
    expect(sollStundenTag("2026-05-15", profil, unsortiert, [])).toBeCloseTo(6.4, 5);
    expect(sollStundenTag("2026-06-15", profil, unsortiert, [])).toBeCloseTo(4.8, 5);
    const sortiertesSoll = kennzahlen({
      from: "2026-04-01", to: "2026-06-30", heute: "2026-07-01",
      eintraege: [], profil, changes, holidays: [], payouts: [], kundenstunden: 0,
    }).soll;
    const unsortiertesSoll = kennzahlen({
      from: "2026-04-01", to: "2026-06-30", heute: "2026-07-01",
      eintraege: [], profil, changes: unsortiert, holidays: [], payouts: [], kundenstunden: 0,
    }).soll;
    expect(unsortiertesSoll).toBe(sortiertesSoll);
  });

  it("bei zwei Changes mit identischem effectiveFrom gewinnt der zuletzt übergebene", () => {
    // PensumChange hat kein @@unique([userId, effectiveFrom]) — zwei Einträge
    // auf denselben Tag sind möglich (z.B. Korrektur). Ohne feste Regel hinge
    // das Ergebnis von der Array-Reihenfolge ab.
    const kollision = [
      { effectiveFrom: "2026-05-01", pensum: 80, wochenstunden: 40 },
      { effectiveFrom: "2026-05-01", pensum: 50, wochenstunden: 40 },
    ];
    expect(pensumAt("2026-05-15", profil, kollision)).toEqual({ pensum: 50, wochenstunden: 40 });
    expect(sollStundenTag("2026-05-15", profil, kollision, [])).toBeCloseTo(4, 5);
  });

  it("feriensaldo rechnet jeden Ferientag über das Tagessoll SEINES Monats in genau 1.0 Tage um", () => {
    const result = feriensaldo({
      jahr: 2026,
      heute: "2026-07-01",
      profil,
      changes,
      holidays: [],
      eintraege: [
        { date: "2026-04-15", typ: "ferien", hours: 8 },   // 100% → Tagessoll 8
        { date: "2026-05-15", typ: "ferien", hours: 6.4 }, // 80%  → Tagessoll 6.4
        { date: "2026-06-15", typ: "ferien", hours: 4.8 }, // 60%  → Tagessoll 4.8
      ],
    });
    // Ohne korrekte Auflösung pro Tag (z.B. immer der letzte Satz 4.8):
    // 8/4.8 + 6.4/4.8 + 1 = 1.67 + 1.33 + 1 = 4.0 statt 3.0
    expect(result.bezogen).toBe(3);
    expect(result.geplant).toBe(0);
    expect(result.anspruch).toBe(25);
    expect(result.offen).toBe(22);
  });

  it("teamKennzahlen: Person mit Wechseln und Person ohne bekommen je ihr eigenes Soll", () => {
    const result = teamKennzahlen({
      from: "2026-04-01",
      to: "2026-06-30",
      heute: "2026-07-01",
      holidays: [],
      members: [
        { userId: "mit", name: "Mit Wechseln", profil, changes, eintraege: [], payouts: [], kundenstunden: 0 },
        { userId: "ohne", name: "Ohne Wechsel", profil, changes: [], eintraege: [], payouts: [], kundenstunden: 0 },
      ],
    });
    expect(result.members.find((m) => m.userId === "mit")!.soll).toBe(Q2_SOLL);
    // 65 Werktage × 8h, unabhängig ausgezählt
    expect(result.members.find((m) => m.userId === "ohne")!.soll).toBe(520);
    expect(result.totals.soll).toBe(Q2_SOLL + 520);
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
      kundenstunden: 0,
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
      kundenstunden: 0,
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
      kundenstunden: 0,
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
      kundenstunden: 0,
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
      kundenstunden: 0,
    });
    expect(result.ist).toBe(0);
    expect(result.verrechnungsgrad).toBe(0);
    expect(Number.isNaN(result.verrechnungsgrad)).toBe(false);
  });

  // Kundenstunden kommen seit dem Wechsel auf monatliche Erfassung
  // (Betrieb.md-Nachtrag, 18.08.2026) nicht mehr aus billable-Zeiteinträgen,
  // sondern werden vom Aufrufer aus CustomerMonth vorberechnet (siehe
  // lib/customer-months.ts) und hier nur noch durchgereicht.
  it("reicht die übergebenen Kundenstunden durch und rechnet verrechnungsgrad daraus", () => {
    const profil: Profil = { wochenstunden: 40, pensum: 100, ferientage: 25, startDate: "2026-01-01", exitDate: null, maxWeeklyHours: 45 };
    const result = kennzahlen({
      from: "2026-08-10",
      to: "2026-08-11",
      heute: "2026-08-12",
      eintraege: [
        { date: "2026-08-10", typ: "arbeit", von: "08:00", bis: "16:00", pauseMin: 0 },
        { date: "2026-08-11", typ: "arbeit", von: "08:00", bis: "16:00", pauseMin: 0 },
      ],
      profil,
      changes: [],
      holidays: [],
      payouts: [],
      kundenstunden: 8,
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
      kundenstunden: 0,
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
      kundenstunden: 0,
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
      kundenstunden: 0,
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
      kundenstunden: 0,
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
      kundenstunden: 0,
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
      kundenstunden: 0,
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
      kundenstunden: 0,
    });
    expect(result.soll).toBe(0);
    expect(result.ist).toBe(4);
  });
});

// MIGRATION.md Punkt 7 — ArG-Kontrollexport braucht die wöchentliche
// Arbeitszeit und Überzeit separat je Woche. Früher auch von der
// Teamsicht-Heatmap/-Prognose genutzt (kundenstunden/verrechnungsgrad/
// auslastung je Woche) — mit dem Wechsel auf monatliche Kundenstunden-
// Erfassung entfallen (Betrieb.md-Nachtrag, 18.08.2026), siehe Kommentar
// bei wochenUebersicht.
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
    const result = wochenUebersicht(eintraege, profil, "2026-08-03", "2026-08-14");
    expect(result.map((w) => w.montag)).toEqual(["2026-08-03", "2026-08-10"]);
  });

  it("liefert auch Wochen ganz ohne Einträge mit 0-Werten (dichte Wochenliste)", () => {
    const eintraege = [{ date: "2026-08-03", typ: "arbeit" as const, von: "08:00", bis: "17:00", pauseMin: 0 }];
    // Zeitraum über zwei Wochen (KW1 mit Eintrag, KW2 ganz leer).
    const result = wochenUebersicht(eintraege, profil, "2026-08-03", "2026-08-14");
    expect(result.map((w) => w.montag)).toEqual(["2026-08-03", "2026-08-10"]);
    expect(result[1].arbeitsstunden).toBe(0);
  });

  it("ignoriert Einträge ausserhalb von [from, to]", () => {
    const eintraege = [{ date: "2026-08-03", typ: "arbeit" as const, von: "08:00", bis: "17:00", pauseMin: 0 }];
    const result = wochenUebersicht(eintraege, profil, "2026-08-10", "2026-08-14");
    expect(result).toHaveLength(1);
    expect(result[0].arbeitsstunden).toBe(0);
  });

  it("zählt Absenzen nicht als Arbeitszeit", () => {
    const eintraege = [{ date: "2026-08-03", typ: "ferien" as const, hours: 8 }];
    const result = wochenUebersicht(eintraege, profil, "2026-08-03", "2026-08-07");
    expect(result[0].arbeitsstunden).toBe(0);
  });
});

// MIGRATION.md Punkt 8 — Teamsicht: Aggregation über mehrere Personen.
describe("teamKennzahlen (MIGRATION.md Punkt 8)", () => {
  const profilA: Profil = { wochenstunden: 40, pensum: 100, ferientage: 25, startDate: null, exitDate: null, maxWeeklyHours: 45 };
  const profilB: Profil = { wochenstunden: 40, pensum: 50, ferientage: 25, startDate: null, exitDate: null, maxWeeklyHours: 45 };

  it("liefert pro Mitglied dieselben Werte wie ein direkter kennzahlen()-Aufruf", () => {
    const eintraegeA = [{ date: "2026-08-03", typ: "arbeit" as const, von: "08:00", bis: "17:00", pauseMin: 0 }];
    const direkt = kennzahlen({ from: "2026-08-03", to: "2026-08-07", heute: "2026-08-07", eintraege: eintraegeA, profil: profilA, changes: [], payouts: [], holidays: [], kundenstunden: 5 });

    const result = teamKennzahlen({
      from: "2026-08-03",
      to: "2026-08-07",
      heute: "2026-08-07",
      holidays: [],
      members: [{ userId: "u1", name: "A", profil: profilA, changes: [], eintraege: eintraegeA, payouts: [], kundenstunden: 5 }],
    });

    expect(result.members).toHaveLength(1);
    expect(result.members[0].soll).toBe(direkt.soll);
    expect(result.members[0].ist).toBe(direkt.ist);
    expect(result.members[0].ueberstunden).toBe(direkt.ueberstunden);
    expect(result.members[0].kundenstunden).toBe(direkt.kundenstunden);
  });

  it("totals summieren soll/ist/ueberstunden/kundenstunden über alle Mitglieder", () => {
    // Kundenstunden kommen seit dem Wechsel auf monatliche Erfassung
    // (Betrieb.md-Nachtrag, 18.08.2026) direkt als Parameter je Person,
    // nicht mehr aus billable-Zeiteinträgen.
    const eintraegeA = [{ date: "2026-08-03", typ: "arbeit" as const, von: "08:00", bis: "16:00", pauseMin: 0 }]; // 8h
    const eintraegeB = [{ date: "2026-08-03", typ: "arbeit" as const, von: "08:00", bis: "12:00", pauseMin: 0 }]; // 4h

    const result = teamKennzahlen({
      from: "2026-08-03",
      to: "2026-08-03",
      heute: "2026-08-03",
      holidays: [],
      members: [
        { userId: "u1", name: "A", profil: profilA, changes: [], eintraege: eintraegeA, payouts: [], kundenstunden: 8 },
        { userId: "u2", name: "B", profil: profilB, changes: [], eintraege: eintraegeB, payouts: [], kundenstunden: 0 },
      ],
    });

    expect(result.totals.ist).toBe(12); // 8h + 4h
    expect(result.totals.kundenstunden).toBe(8); // nur A hat Kundenstunden
    expect(result.totals.verrechnungsgrad).toBe(66.7); // 8/12*100, gerundet
  });

  it("verrechnungsgrad ist 0 bei totals.ist = 0 (keine Division durch 0)", () => {
    const result = teamKennzahlen({
      from: "2026-08-03",
      to: "2026-08-03",
      heute: "2026-08-03",
      holidays: [],
      members: [{ userId: "u1", name: "A", profil: profilA, changes: [], eintraege: [], payouts: [], kundenstunden: 0 }],
    });
    expect(result.totals.ist).toBe(0);
    expect(result.totals.verrechnungsgrad).toBe(0);
  });

  // HARDENING.md A4 — eine Person ganz ohne Einträge im Zeitraum darf in
  // KEINEM Feld NaN oder Infinity liefern, auch nicht neben Personen, die
  // Einträge haben (ist = 0 → Division durch 0 in verrechnungsgrad).
  it("Person ohne jeden Eintrag: alle Kennzahlen sind endliche Zahlen, verrechnungsgrad ist 0", () => {
    const profil: Profil = { wochenstunden: 40, pensum: 100, ferientage: 25, startDate: "2026-01-01", exitDate: null, maxWeeklyHours: 45 };
    const result = teamKennzahlen({
      from: "2026-08-03",
      to: "2026-08-07",
      heute: "2026-08-07",
      holidays: [],
      members: [
        { userId: "leer", name: "Ohne Einträge", profil, changes: [], eintraege: [], payouts: [], kundenstunden: 0 },
        {
          userId: "voll", name: "Mit Einträgen", profil, changes: [], payouts: [], kundenstunden: 8,
          eintraege: [{ date: "2026-08-03", typ: "arbeit", von: "08:00", bis: "16:00", pauseMin: 0 }],
        },
      ],
    });

    const leer = result.members.find((m) => m.userId === "leer")!;
    expect(leer.ist).toBe(0);
    expect(leer.kundenstunden).toBe(0);
    expect(leer.verrechnungsgrad).toBe(0);
    expect(leer.soll).toBe(40); // 5 Werktage × 8h — das Soll bleibt, nur ist ist 0
    expect(leer.ueberstunden).toBe(-40);
    for (const [feld, wert] of Object.entries(leer)) {
      if (typeof wert === "number") expect(Number.isFinite(wert), `${feld} von leer`).toBe(true);
    }

    // Die leere Person darf die Team-Summen nicht vergiften.
    expect(Number.isFinite(result.totals.verrechnungsgrad)).toBe(true);
    expect(result.totals.ist).toBe(8);
    expect(result.totals.verrechnungsgrad).toBe(100);
  });

  it("liefert eine leere Mitgliederliste und Null-Totals ohne Mitglieder", () => {
    const result = teamKennzahlen({ from: "2026-08-03", to: "2026-08-03", heute: "2026-08-03", holidays: [], members: [] });
    expect(result.members).toEqual([]);
    expect(result.totals).toEqual({ soll: 0, ist: 0, ueberstunden: 0, kundenstunden: 0, verrechnungsgrad: 0 });
  });
});

// HARDENING.md A3 — Jahresübergänge und Kalenderrandfälle.
describe("Kalenderrandfälle (HARDENING.md A3)", () => {
  const vollzeit: Profil = {
    wochenstunden: 40,
    pensum: 100,
    ferientage: 25,
    startDate: "2020-01-01",
    exitDate: null,
    maxWeeklyHours: 45,
  };

  describe("Ferienanspruch am Jahresrand", () => {
    it("Eintritt exakt am 01.01. gibt den vollen Jahresanspruch", () => {
      const profil: Profil = { ...vollzeit, startDate: "2026-01-01" };
      const result = feriensaldo({ jahr: 2026, heute: "2026-12-31", profil, changes: [], holidays: [], eintraege: [] });
      expect(result.anspruch).toBe(25);
    });

    it("Eintritt exakt am 31.12. gibt genau einen Monatsanteil (25/12 = 2.1)", () => {
      const profil: Profil = { ...vollzeit, startDate: "2026-12-31" };
      const result = feriensaldo({ jahr: 2026, heute: "2026-12-31", profil, changes: [], holidays: [], eintraege: [] });
      expect(result.anspruch).toBe(2.1);
    });

    it("Eintritt am 31.12. des VORjahres gibt im Folgejahr den vollen Anspruch", () => {
      const profil: Profil = { ...vollzeit, startDate: "2025-12-31" };
      const result = feriensaldo({ jahr: 2026, heute: "2026-06-30", profil, changes: [], holidays: [], eintraege: [] });
      expect(result.anspruch).toBe(25);
    });

    it("dokumentiert: exitDate kürzt den Anspruch NICHT (nur startDate geht ein)", () => {
      // Bewusst festgehaltenes Ist-Verhalten, kein Wunschverhalten: wer am
      // 31.01.2026 austritt, bekommt für 2026 trotzdem den vollen Anspruch.
      // Siehe "Notizen des Loops" in HARDENING.md — eine anteilige Kürzung
      // bei Austritt ist eine fehlende REGEL, kein Rechenfehler, und wird in
      // diesem Loop bewusst nicht gebaut.
      const profil: Profil = { ...vollzeit, startDate: "2020-01-01", exitDate: "2026-01-31" };
      const result = feriensaldo({ jahr: 2026, heute: "2026-12-31", profil, changes: [], holidays: [], eintraege: [] });
      expect(result.anspruch).toBe(25);
    });
  });

  describe("Kalenderwoche über den Jahreswechsel (KW 53/2026 → KW 1/2027)", () => {
    // Mo 28.12.2026 – So 03.01.2027; Werktage sind Mo–Do (28.–31.12.) und
    // Fr 01.01.2027 → 5 Werktage.
    const eintraege = [
      { date: "2026-12-28", typ: "arbeit" as const, von: "08:00", bis: "18:00", pauseMin: 0 },
      { date: "2026-12-29", typ: "arbeit" as const, von: "08:00", bis: "18:00", pauseMin: 0 },
      { date: "2026-12-30", typ: "arbeit" as const, von: "08:00", bis: "18:00", pauseMin: 0 },
      { date: "2026-12-31", typ: "arbeit" as const, von: "08:00", bis: "18:00", pauseMin: 0 },
      { date: "2027-01-01", typ: "arbeit" as const, von: "08:00", bis: "18:00", pauseMin: 0 },
    ];

    it("wochenUebersicht fasst die Woche zu EINEM Eintrag zusammen, nicht zu zwei Jahresteilen", () => {
      const wochen = wochenUebersicht(eintraege, vollzeit, "2026-12-28", "2027-01-03");
      expect(wochen).toHaveLength(1);
      expect(wochen[0].montag).toBe("2026-12-28");
      expect(wochen[0].arbeitsstunden).toBe(50);
    });

    it("die Überzeit der Woche wird über den Jahreswechsel hinweg als eine Woche gerechnet", () => {
      const wochen = wochenUebersicht(eintraege, vollzeit, "2026-12-28", "2027-01-03");
      expect(wochen[0].ueberzeit).toBe(5); // 50h − 45h
      const k = kennzahlen({
        from: "2026-12-28", to: "2027-01-03", heute: "2027-01-03",
        eintraege, profil: vollzeit, changes: [], holidays: [], payouts: [],
        kundenstunden: 0,
      });
      // Eine einzige Woche über dem Limit, nicht zwei Teilwochen mit je 0.
      expect(k.ueberzeit).toBe(5);
      expect(k.ist).toBe(50);
      expect(k.soll).toBe(40);
    });

    it("montagDerWoche liefert für den 01.01.2027 (Fr) den Montag des Vorjahres", () => {
      expect(montagDerWoche(new Date("2027-01-01T00:00:00Z")).toISOString().split("T")[0]).toBe("2026-12-28");
    });
  });

  describe("Schaltjahr", () => {
    it("Februar 2028 (29 Tage, 21 Werktage) hat mehr Soll als Februar 2026 (28 Tage, 20 Werktage)", () => {
      const feb2026 = kennzahlen({
        from: "2026-02-01", to: "2026-02-28", heute: "2026-03-01",
        eintraege: [], profil: vollzeit, changes: [], holidays: [], payouts: [],
 kundenstunden: 0,
      });
      const feb2028 = kennzahlen({
        from: "2028-02-01", to: "2028-02-29", heute: "2028-03-01",
        eintraege: [], profil: vollzeit, changes: [], holidays: [], payouts: [],
 kundenstunden: 0,
      });
      expect(feb2026.soll).toBe(160); // 20 × 8h
      expect(feb2028.soll).toBe(168); // 21 × 8h
    });

    it("der 29.02.2028 ist ein normaler Werktag (Di) mit vollem Tagessoll", () => {
      expect(sollStundenTag("2028-02-29", vollzeit, [], [])).toBeCloseTo(8, 5);
    });
  });

  describe("Sommerzeitwechsel (letzter Sonntag im März/Oktober)", () => {
    // Der Prozess läuft in Europe/Zurich; die Berechnung darf davon nicht
    // abhängen. sollStundenTag/stundenAusEintrag rechnen bewusst in UTC bzw.
    // auf Wanduhr-Minuten — diese Tests halten fest, dass der Wechsel weder
    // das Datum verschiebt noch die Stundenberechnung verändert.
    it("verschiebt kein Datum: der Umstellungssonntag bleibt Sonntag, der Folgetag Montag", () => {
      expect(sollStundenTag("2026-03-29", vollzeit, [], [])).toBe(0); // So
      expect(sollStundenTag("2026-03-30", vollzeit, [], [])).toBeCloseTo(8, 5); // Mo
      expect(sollStundenTag("2026-10-25", vollzeit, [], [])).toBe(0); // So
      expect(sollStundenTag("2026-10-26", vollzeit, [], [])).toBeCloseTo(8, 5); // Mo
    });

    it("Nachtschicht über Mitternacht liefert am Umstellungstag dasselbe wie an jedem anderen Tag", () => {
      // 22:00–06:00 mit 30 Min Pause. Wanduhrzeit = 7.5h. In der Nacht auf den
      // Frühjahrswechsel dauert die Schicht real 6.5h, auf den Herbstwechsel
      // 8.5h — die Berechnung ist bewusst reine Wanduhrarithmetik und liefert
      // in allen drei Fällen 7.5h. Bewusst festgehaltenes Ist-Verhalten, siehe
      // "Notizen des Loops" in HARDENING.md.
      const nacht = (datum: string) =>
        kennzahlen({
          from: datum, to: datum, heute: "2027-01-01",
          eintraege: [{ date: datum, typ: "arbeit", von: "22:00", bis: "06:00", pauseMin: 30 }],
          profil: vollzeit, changes: [], holidays: [], payouts: [], kundenstunden: 0,
        }).ist;

      expect(nacht("2026-03-28")).toBe(7.5); // Nacht auf den Frühjahrswechsel
      expect(nacht("2026-10-24")).toBe(7.5); // Nacht auf den Herbstwechsel
      expect(nacht("2026-06-13")).toBe(7.5); // gewöhnliche Nacht ohne Wechsel
    });

    it("kennzahlen über die Umstellungswoche liefert das unveränderte Wochensoll", () => {
      // Mo 23.03. – So 29.03.2026 und Mo 19.10. – So 25.10.2026: je 5 Werktage.
      const maerz = kennzahlen({
        from: "2026-03-23", to: "2026-03-29", heute: "2026-03-29",
        eintraege: [], profil: vollzeit, changes: [], holidays: [], payouts: [],
 kundenstunden: 0,
      });
      const oktober = kennzahlen({
        from: "2026-10-19", to: "2026-10-25", heute: "2026-10-25",
        eintraege: [], profil: vollzeit, changes: [], holidays: [], payouts: [],
 kundenstunden: 0,
      });
      expect(maerz.soll).toBe(40);
      expect(oktober.soll).toBe(40);
    });

    it("eine Nachtschicht am Umstellungssamstag landet auf dem Samstag, nicht auf dem Sonntag", () => {
      // Der Eintrag gehört dem Kalendertag seines von-Zeitpunkts; die
      // Verschiebung über Mitternacht darf ihn nicht in den Folgetag kippen.
      const k = kennzahlen({
        from: "2026-03-28", to: "2026-03-28", heute: "2026-03-29",
        eintraege: [{ date: "2026-03-28", typ: "arbeit", von: "22:00", bis: "06:00", pauseMin: 30 }],
        profil: vollzeit, changes: [], holidays: [], payouts: [],
 kundenstunden: 0,
      });
      expect(k.ist).toBe(7.5);
      expect(k.soll).toBe(0); // Samstag
    });
  });
});
