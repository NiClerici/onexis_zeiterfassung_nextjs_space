import { describe, expect, it } from "vitest";
import { easterSunday, swissBasisFeiertage, kantonaleFeiertage, generateHolidaysForYear } from "./holidays";

describe("easterSunday", () => {
  // Referenzwerte gegengeprüft mit dem Standard-Gauss-Algorithmus (unabhängige
  // Implementierung), nicht nur mit dem eigenen Code — sonst testet man nur
  // sich selbst.
  it("berechnet bekannte Ostersonntage korrekt", () => {
    expect(easterSunday(2024)).toEqual(new Date(Date.UTC(2024, 2, 31)));
    expect(easterSunday(2025)).toEqual(new Date(Date.UTC(2025, 3, 20)));
    expect(easterSunday(2026)).toEqual(new Date(Date.UTC(2026, 3, 5)));
    expect(easterSunday(2027)).toEqual(new Date(Date.UTC(2027, 2, 28)));
    expect(easterSunday(2028)).toEqual(new Date(Date.UTC(2028, 3, 16)));
  });
});

describe("swissBasisFeiertage", () => {
  const feiertage2026 = swissBasisFeiertage(2026);

  it("enthält Karfreitag (beweglich, 2 Tage vor Ostern) am korrekten Datum 2026", () => {
    const karfreitag = feiertage2026.find((f) => f.name === "Karfreitag");
    expect(karfreitag?.date).toBe("2026-04-03");
    expect(karfreitag?.canton).toBeNull();
    expect(karfreitag?.halfDay).toBe(false);
  });

  it("enthält Ostermontag (beweglich, 1 Tag nach Ostern) am korrekten Datum 2026", () => {
    const ostermontag = feiertage2026.find((f) => f.name === "Ostermontag");
    expect(ostermontag?.date).toBe("2026-04-06");
  });

  it("enthält Auffahrt (39 Tage nach Ostern) und Pfingstmontag (50 Tage nach Ostern)", () => {
    expect(feiertage2026.find((f) => f.name === "Auffahrt")?.date).toBe("2026-05-14");
    expect(feiertage2026.find((f) => f.name === "Pfingstmontag")?.date).toBe("2026-05-25");
  });

  it("enthält die festen Basissatz-Daten (Neujahr, Bundesfeier, Weihnachten, Stephanstag)", () => {
    expect(feiertage2026.find((f) => f.name === "Neujahr")?.date).toBe("2026-01-01");
    expect(feiertage2026.find((f) => f.name === "Bundesfeier")?.date).toBe("2026-08-01");
    expect(feiertage2026.find((f) => f.name === "Weihnachten")?.date).toBe("2026-12-25");
    expect(feiertage2026.find((f) => f.name === "Stephanstag")?.date).toBe("2026-12-26");
  });

  it("liefert genau 8 Basissatz-Feiertage, alle mit canton: null", () => {
    expect(feiertage2026).toHaveLength(8);
    expect(feiertage2026.every((f) => f.canton === null)).toBe(true);
  });
});

describe("kantonaleFeiertage", () => {
  it("liefert den Kantonsfeiertag Jura am 23. Juni, mit korrektem canton-Feld", () => {
    const ju = kantonaleFeiertage(2026, "JU");
    expect(ju).toHaveLength(1);
    expect(ju[0]).toEqual({ date: "2026-06-23", name: "Kantonsfeiertag Jura", canton: "JU", halfDay: false });
  });

  it("liefert Berchtoldstag für ZH am 2. Januar", () => {
    const zh = kantonaleFeiertage(2026, "ZH");
    expect(zh.find((f) => f.name === "Berchtoldstag")?.date).toBe("2026-01-02");
  });

  it("liefert Fronleichnam (beweglich, 60 Tage nach Ostern) für LU", () => {
    const lu = kantonaleFeiertage(2026, "LU");
    expect(lu.find((f) => f.name === "Fronleichnam")?.date).toBe("2026-06-04");
  });

  it("liefert eine leere Liste für einen Kanton ohne bestätigte Zusatztage (BL)", () => {
    expect(kantonaleFeiertage(2026, "BL")).toEqual([]);
  });

  it("liefert für die erweiterte katholische Gruppe (FR) jetzt ebenfalls Fronleichnam", () => {
    const fr = kantonaleFeiertage(2026, "FR");
    expect(fr.find((f) => f.name === "Fronleichnam")?.date).toBe("2026-06-04");
    expect(fr.find((f) => f.name === "Mariä Himmelfahrt")?.date).toBe("2026-08-15");
    expect(fr.find((f) => f.name === "Allerheiligen")?.date).toBe("2026-11-01");
  });

  // Genf: eigene, vollständige Liste statt Zusatz zum Basissatz — dediziert
  // recherchiert (Quellen im Plan), 9 gesetzliche Feiertage 2026 total.
  it("liefert für GE Jeûne genevois (Donnerstag nach 1. Sonntag im September) und Restauration de la République", () => {
    const ge = kantonaleFeiertage(2026, "GE");
    expect(ge.find((f) => f.name === "Jeûne genevois")?.date).toBe("2026-09-10");
    expect(ge.find((f) => f.name === "Restauration de la République")?.date).toBe("2026-12-31");
  });

  it("GE hat 2026 insgesamt 9 gesetzliche Feiertage (kein Berchtoldstag, kein 1. Mai, kein Stephanstag)", () => {
    const result = generateHolidaysForYear(2026, "GE");
    expect(result).toHaveLength(9);
    expect(result.some((f) => f.name === "Berchtoldstag")).toBe(false);
    expect(result.some((f) => f.name === "Tag der Arbeit")).toBe(false);
    expect(result.some((f) => f.name === "Stephanstag")).toBe(false);
  });

  // Waadt: Bettagsmontag ist laut Quelle der einzige Kanton, der diesen Tag
  // gesetzlich anerkennt (Montag nach dem 3. Sonntag im September).
  it("liefert für VD den Bettagsmontag am korrekten Datum 2026", () => {
    const vd = kantonaleFeiertage(2026, "VD");
    expect(vd.find((f) => f.name === "Bettagsmontag")?.date).toBe("2026-09-21");
  });

  // Neuenburg: fixer Gründungstag (1. März), 2026 auf einen Sonntag fallend
  // → gesetzlich auf den folgenden Montag verschoben (2. März).
  it("liefert für NE die Instauration de la République, 2026 auf Montag verschoben (1. März ist ein Sonntag)", () => {
    const ne = kantonaleFeiertage(2026, "NE");
    expect(ne.find((f) => f.name === "Instauration de la République")?.date).toBe("2026-03-02");
  });

  it("verschiebt die Instauration de la République NICHT, wenn der 1. März kein Sonntag ist (2027: Montag)", () => {
    const ne2027 = kantonaleFeiertage(2027, "NE");
    expect(ne2027.find((f) => f.name === "Instauration de la République")?.date).toBe("2027-03-01");
  });

  // Basel-Stadt: Fasnacht ist relativ zu Ostern (über den Aschermittwoch),
  // beide Tage nur halbtags frei — Daten gegengeprüft mit der Quelle.
  it("liefert für BS Fasnachtsmontag/-mittwoch als Halbtage am korrekten Datum 2026", () => {
    const bs = kantonaleFeiertage(2026, "BS");
    const montag = bs.find((f) => f.name === "Fasnachtsmontag");
    const mittwoch = bs.find((f) => f.name === "Fasnachtsmittwoch");
    expect(montag?.date).toBe("2026-02-23");
    expect(montag?.halfDay).toBe(true);
    expect(mittwoch?.date).toBe("2026-02-25");
    expect(mittwoch?.halfDay).toBe(true);
  });
});

describe("generateHolidaysForYear", () => {
  it("liefert ohne Kanton nur den Basissatz", () => {
    expect(generateHolidaysForYear(2026)).toEqual(swissBasisFeiertage(2026));
  });

  it("liefert mit Kanton Basissatz plus kantonale Feiertage", () => {
    const result = generateHolidaysForYear(2026, "JU");
    expect(result).toHaveLength(9); // 8 Basissatz + 1 Kantonsfeiertag Jura
    expect(result.some((f) => f.name === "Kantonsfeiertag Jura")).toBe(true);
  });

  // Zwei unabhängige Quellen bestätigen: "Tessin und Wallis sind die
  // einzigen Kantone, wo Karfreitag ein normaler Arbeitstag ist" —
  // swissBasisFeiertage() setzt ihn trotzdem kantonsunabhängig, deshalb
  // filtert generateHolidaysForYear() ihn für diese zwei Kantone heraus.
  it("enthält KEINEN Karfreitag für TI und VS (kein gesetzlicher Feiertag dort)", () => {
    expect(generateHolidaysForYear(2026, "TI").some((f) => f.name === "Karfreitag")).toBe(false);
    expect(generateHolidaysForYear(2026, "VS").some((f) => f.name === "Karfreitag")).toBe(false);
  });

  it("enthält Karfreitag weiterhin für die übrigen 24 Kantone (Regressionsschutz)", () => {
    expect(generateHolidaysForYear(2026, "ZH").some((f) => f.name === "Karfreitag")).toBe(true);
    expect(generateHolidaysForYear(2026).some((f) => f.name === "Karfreitag")).toBe(true); // ohne Kanton
  });

  it("TI hat 2026 insgesamt 15 gesetzliche Feiertage (dediziert gegengeprüft)", () => {
    expect(generateHolidaysForYear(2026, "TI")).toHaveLength(15);
  });

  it("VS hat 2026 insgesamt 12 gesetzliche Feiertage (dediziert gegengeprüft)", () => {
    expect(generateHolidaysForYear(2026, "VS")).toHaveLength(12);
  });

  it("liefert für alle 26 Kantone eine Liste (keiner wirft oder liefert undefined)", () => {
    const alleKantone = [
      "ZH", "BE", "LU", "UR", "SZ", "OW", "NW", "GL", "ZG", "FR", "SO", "BS", "BL",
      "SH", "AR", "AI", "SG", "GR", "AG", "TG", "TI", "VD", "VS", "NE", "GE", "JU",
    ];
    for (const canton of alleKantone) {
      const result = generateHolidaysForYear(2026, canton);
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThanOrEqual(8); // mindestens der Basissatz (ggf. minus Ausnahme)
    }
  });
});
